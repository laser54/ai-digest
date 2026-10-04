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
import { createDigestHistory } from './digest-history.js';
import { fetchArticleEvidence } from './evidence.js';
import { isRetryEligibleOutcome } from '../public/safe-links.js';

export const requestSchema = z.object({
  sourceUrls: z.array(z.string().url()).min(1).max(10).transform((urls) => urls.map((value) => new URL(value).href)),
  themes: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  editorialPrompt: z.string().trim().max(4000).default(''),
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
  themes: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  editorialPrompt: z.string().trim().max(4000).default('')
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
    verifyArticleEvidence: fetchArticleEvidence,
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

export function createApp({ password = process.env.ADMIN_PASSWORD, jobs, history } = {}) {
  const app = express();
  const auth = (req, res, next) => createExecutionAuth(password)(req, res, next);
  const digestHistory = history || createDigestHistory(process.env.DIGEST_HISTORY_DIR || (process.env.NODE_ENV === 'production' ? '/codex/digests' : path.join(process.cwd(), 'data/digests')));
  const persistJobs = !jobs || Boolean(history);
  const digestJobs = jobs || createDigestJobs({
    // ponytail: process-local queue assumes one replica; use shared storage only if replicas are introduced.
    worker: (input, onProgress, logger) => runDigest(input, onProgress, logger)
  });
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));

  app.post('/api/digest/jobs', auth, async (req, res) => {
    let pendingHistory = null;
    try {
      const input = startRequestSchema.parse(req.body);
      await Promise.all(input.sourceUrls.map(validatePublicHttpUrl));
      const { submissionId, ...snapshot } = input;
      if (persistJobs) {
        pendingHistory = await digestHistory.create({ snapshot, status: 'queued', name: `Выпуск ${new Date().toLocaleString()}` });
      }
      const hooks = pendingHistory ? {
        historyId: pendingHistory.id,
        onStart: () => digestHistory.updateStatus(pendingHistory.id, 'running'),
        onComplete: (_jobInput, result) => digestHistory.complete(pendingHistory.id, result),
        onFailure: () => digestHistory.updateStatus(pendingHistory.id, 'error')
      } : {};
      const submitted = digestJobs.submit(input, hooks);
      if (pendingHistory && submitted.historyId !== pendingHistory.id) {
        await digestHistory.remove(pendingHistory.id, pendingHistory.revision);
        pendingHistory = null;
      }
      res.status(202).json(submitted);
    } catch (error) {
      if (pendingHistory) await digestHistory.remove(pendingHistory.id, pendingHistory.revision).catch(() => {});
      if (error?.code === 'submission_conflict') {
        return res.status(409).json({ code: 'submission_conflict', error: 'Этот ID уже использован с другими параметрами. Начните новый поиск.' });
      }
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

  app.get('/api/digests', auth, async (req, res) => {
    try {
      const limit = Number(req.query.limit || 20);
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      res.json(await digestHistory.list({ limit, cursor }));
    } catch (error) { res.status(error?.code === 'invalid_history_cursor' ? 400 : 500).json({ error: 'Не удалось прочитать историю выпусков' }); }
  });

  app.post('/api/digests/list', auth, async (req, res) => {
    try {
      const body = z.object({ limit: z.number().int().optional(), cursor: z.string().optional() }).parse(req.body);
      res.json(await digestHistory.list(body));
    } catch (error) { res.status(400).json({ error: 'Не удалось прочитать историю выпусков' }); }
  });

  app.post('/api/digests/:id/retries', auth, async (req, res) => {
    try {
      const body = z.object({
        revision: z.number().int().positive(),
        submissionId: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/),
        selectedSourceUrls: z.array(z.string().url()).min(1).max(10)
      }).parse(req.body);
      const parent = await digestHistory.get(req.params.id);
      if (!parent) return res.status(404).json({ error: 'Выпуск не найден' });
      const existing = parent.attempts.find((attempt) => attempt.submissionId === body.submissionId);
      if (existing) {
        if (JSON.stringify([...existing.selectedSourceUrls].sort()) !== JSON.stringify([...body.selectedSourceUrls].sort())) {
          return res.status(409).json({ code: 'submission_conflict', error: 'Этот ID уже связан с другим набором источников. Начните новую попытку.' });
        }
        const live = existing.jobId ? digestJobs.status(existing.jobId) : null;
        return res.status(202).json({ jobId: existing.jobId, status: live?.status || existing.status, reused: true, attemptId: existing.id });
      }
      const retryable = new Set((parent.result.researchSources || [])
        .filter((source) => isRetryEligibleOutcome(source.outcome))
        .map((source) => source.url));
      if (!body.selectedSourceUrls.every((url) => retryable.has(url))
        || new Set(body.selectedSourceUrls).size !== body.selectedSourceUrls.length) {
        return res.status(400).json({ error: 'Можно повторить только выбранные источники со сбоем/тайм-аутом; успешные и пустые источники исключены.' });
      }
      await Promise.all(body.selectedSourceUrls.map(validatePublicHttpUrl));
      const started = await digestHistory.beginRetry(req.params.id, {
        submissionId: body.submissionId,
        selectedSourceUrls: body.selectedSourceUrls
      }, body.revision);
      if (!started) return res.status(404).json({ error: 'Выпуск не найден' });
      if (started.reused) {
        const live = started.attempt.jobId ? digestJobs.status(started.attempt.jobId) : null;
        return res.status(202).json({ jobId: started.attempt.jobId, status: live?.status || started.attempt.status, reused: true, attemptId: started.attempt.id });
      }
      const retryInput = {
        ...parent.snapshot,
        sourceUrls: body.selectedSourceUrls,
        submissionId: body.submissionId,
        retryParentId: parent.id,
        retryAttemptId: started.attempt.id
      };
      const hooks = {
        onStart: () => digestHistory.updateRetryStatus(parent.id, started.attempt.id, 'running'),
        onComplete: (_input, result) => digestHistory.finishRetry(parent.id, started.attempt.id, { status: 'complete', result }),
        onFailure: (_input, error) => digestHistory.finishRetry(parent.id, started.attempt.id, { status: 'error', error: 'Повторная попытка завершилась ошибкой' })
      };
      let submitted;
      try { submitted = digestJobs.submit(retryInput, hooks); }
      catch (error) {
        await digestHistory.finishRetry(parent.id, started.attempt.id, { status: 'error', error: 'Не удалось поставить повтор в очередь' });
        throw error;
      }
      const live = digestJobs.status(submitted.jobId);
      await digestHistory.attachRetryJob(parent.id, started.attempt.id, submitted.jobId, live?.status || 'queued');
      return res.status(202).json({ ...submitted, attemptId: started.attempt.id });
    } catch (error) {
      if (error?.code === 'history_revision_conflict') {
        const latest = await digestHistory.get(req.params.id).catch(() => null);
        const same = latest?.attempts.find((attempt) => attempt.submissionId === req.body?.submissionId);
        if (same && JSON.stringify([...same.selectedSourceUrls].sort()) === JSON.stringify([...(req.body?.selectedSourceUrls || [])].sort())) {
          const live = same.jobId ? digestJobs.status(same.jobId) : null;
          return res.status(202).json({ jobId: same.jobId, status: live?.status || same.status, reused: true, attemptId: same.id });
        }
        return res.status(409).json({ code: error.code, error: 'Выпуск изменён в другой вкладке. Перезагрузите его перед повтором.' });
      }
      if (error?.code === 'submission_conflict') return res.status(409).json({ code: error.code, error: 'Этот ID уже связан с другой задачей.' });
      return res.status(400).json({ error: 'Не удалось запустить повтор источников' });
    }
  });

  app.post('/api/digests', auth, async (req, res) => {
    try {
      const body = z.object({ snapshot: requestSchema, result: z.record(z.string(), z.unknown()), selectedUrls: z.array(z.string().url()).max(200).default([]), name: z.string().max(120).default('Без названия'), editorialDraft: z.string().max(20_000).default('') }).parse(req.body);
      res.status(201).json(await digestHistory.create(body));
    } catch { res.status(400).json({ error: 'Не удалось сохранить выпуск' }); }
  });

  app.get('/api/digests/:id', auth, async (req, res) => {
    if (!/^dig_[A-Za-z0-9_-]{16,64}$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid digest id' });
    try {
      const item = await digestHistory.get(req.params.id);
      return item ? res.json(item) : res.status(404).json({ error: 'Выпуск не найден' });
    } catch { return res.status(500).json({ error: 'Не удалось прочитать выпуск' }); }
  });

  app.post('/api/digests/:id/read', auth, async (req, res) => {
    if (!/^dig_[A-Za-z0-9_-]{16,64}$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid digest id' });
    try {
      const item = await digestHistory.get(req.params.id);
      return item ? res.json(item) : res.status(404).json({ error: 'Выпуск не найден' });
    } catch { return res.status(500).json({ error: 'Не удалось прочитать выпуск' }); }
  });

  app.patch('/api/digests/:id', auth, async (req, res) => {
    try {
      const body = z.object({ revision: z.number().int().positive(), name: z.string().max(120).optional(), selectedUrls: z.array(z.string().url()).max(200).optional(), editorialDraft: z.string().max(20_000).optional() }).parse(req.body);
      const { revision, ...changes } = body;
      const saved = await digestHistory.update(req.params.id, changes, revision);
      return saved ? res.json(saved) : res.status(404).json({ error: 'Выпуск не найден' });
    } catch (error) {
      if (error?.code === 'history_revision_conflict') return res.status(409).json({ code: error.code, error: 'Выпуск изменён в другой вкладке. Перезагрузите его перед сохранением.' });
      return res.status(400).json({ error: 'Не удалось сохранить изменения' });
    }
  });

  app.delete('/api/digests/:id', auth, async (req, res) => {
    try {
      const body = z.object({ revision: z.number().int().positive() }).parse(req.body);
      const removed = await digestHistory.remove(req.params.id, body.revision);
      return removed ? res.status(204).end() : res.status(404).json({ error: 'Выпуск не найден' });
    } catch (error) {
      if (error?.code === 'history_revision_conflict') return res.status(409).json({ code: error.code, error: 'Выпуск изменён в другой вкладке. Перезагрузите его перед удалением.' });
      return res.status(400).json({ error: 'Не удалось удалить выпуск' });
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
