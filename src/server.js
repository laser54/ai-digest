import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { fetchArticles } from './article-fetcher.js';
import { validatePublicHttpUrl } from './url-policy.js';
import { rankArticlesWithCodex } from './digest-agent.js';
import { discoverDigest } from './discovery.js';
import { createExecutionAuth } from './auth.js';
import { encodeDigestStreamEvent } from './digest-stream.js';
import { readSettings, writeSettings } from './settings-storage.js';
import { createDigestJobs } from './digest-jobs.js';

import { AuditLogger } from './logging.js';

export const requestSchema = z.object({
  sourceUrls: z.array(z.string().url()).min(1).max(10),
  themes: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  from: z.string().date().optional().or(z.literal('')),
  to: z.string().date().optional().or(z.literal(''))
});

const startRequestSchema = requestSchema.extend({
  submissionId: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/)
});

export const settingsSchema = z.object({
  sources: z.array(z.object({
    url: z.string().url(),
    enabled: z.boolean().default(true)
  })).max(50).default([]),
  themes: z.array(z.string().trim().min(1).max(80)).max(50).default([])
});

const PUBLIC_ERROR_MESSAGE = 'Failed to prepare digest';
const DIGEST_HEARTBEAT_INTERVAL_MS = 15_000;
const jobStatusSchema = z.object({ jobId: z.string().regex(/^job_[A-Za-z0-9_-]{6,128}$/) });

function publicErrorPayload(requestId) {
  return { error: PUBLIC_ERROR_MESSAGE, requestId };
}

export function startDigestHeartbeat(res, clock = globalThis) {
  const timer = clock.setInterval(() => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(encodeDigestStreamEvent('heartbeat', {}));
    }
  }, DIGEST_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clock.clearInterval(timer);
  };
  res.once('close', stop);
  return stop;
}

async function runDigest(input, onProgress, logger) {
  const progress = [];
  const digest = await discoverDigest(input, {
    prefetchArticles: (urls) => fetchArticles(urls, 20, { logger }),
    researchWithCodex: (args) => rankArticlesWithCodex({ ...args, logger }),
    logger
  }, (event) => {
    progress.push(event);
    onProgress(event);
  });
  return {
    articles: digest.candidates,
    automaticDigestUrls: digest.automaticDigestUrls,
    progress,
    sources: digest.sources || [],
    researchSources: digest.researchSources || [],
    tokenUsage: digest.tokenUsage || { available: false },
    requestId: logger.requestId
  };
}

export function createApp({ password = process.env.ADMIN_PASSWORD, jobs } = {}) {
  const app = express();
  const auth = (req, res, next) => createExecutionAuth(password)(req, res, next);
  const digestJobs = jobs || createDigestJobs({
    // ponytail: process-local queue assumes one replica; use shared storage only if replicas are introduced.
    worker: (input, onProgress, logger) => runDigest(input, onProgress, logger)
  });
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));

  app.post('/api/digest/jobs', auth, async (req, res) => {
    try {
      const input = startRequestSchema.parse(req.body);
      await Promise.all(input.sourceUrls.map(validatePublicHttpUrl));
      res.status(202).json(digestJobs.submit(input));
    } catch (error) {
      res.status(error?.message === 'Digest service is busy' ? 503 : 400).json({ error: error?.message === 'Digest service is busy' ? error.message : PUBLIC_ERROR_MESSAGE });
    }
  });

  app.post('/api/digest/jobs/status', auth, (req, res) => {
    try {
      const { jobId } = jobStatusSchema.parse(req.body);
      const status = digestJobs.status(jobId);
      if (!status) return res.status(404).json({ error: 'Digest job not found' });
      return res.json(status);
    } catch {
      return res.status(400).json({ error: 'Invalid digest job request' });
    }
  });

  app.post('/api/digest/prepare', auth, async (req, res) => {
  const logger = new AuditLogger();
  let stopHeartbeat = () => {};
  try {
    const input = requestSchema.parse(req.body);
    await Promise.all(input.sourceUrls.map(validatePublicHttpUrl));
    res.type('application/x-ndjson');
    res.set({
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    stopHeartbeat = startDigestHeartbeat(res);
    req.once('aborted', stopHeartbeat);
    const result = await runDigest(input, (event) => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(encodeDigestStreamEvent('progress', event));
      }
    }, logger);
    if (!res.writableEnded && !res.destroyed) {
      res.end(encodeDigestStreamEvent('result', result));
    }
  } catch (error) {
    logger.error('digest.request.failed', {
      errorName: error?.name || 'UnknownError',
      errorStatus: error?.status || 'unknown',
      zodIssues: Array.isArray(error?.issues) ? error.issues.length : null
    });
    if (res.headersSent) {
      if (!res.writableEnded && !res.destroyed) {
        res.end(encodeDigestStreamEvent('error', publicErrorPayload(logger.requestId)));
      }
      return;
    }
    res.status(400).json(publicErrorPayload(logger.requestId));
  } finally {
    stopHeartbeat();
    req.off('aborted', stopHeartbeat);
  }
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await readSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Не удалось прочитать настройки' });
  }
  });

  app.put('/api/settings', async (req, res) => {
  try {
    const input = settingsSchema.parse(req.body);
    const saved = await writeSettings(input);
    res.json(saved);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Не удалось сохранить настройки' });
  }
  });
  return app;
}

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD is required in production');
}
const app = createApp();
export { app };

const isMain = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) {
  app.listen(process.env.PORT || 3030, () => console.log('AI Digest running'));
}
