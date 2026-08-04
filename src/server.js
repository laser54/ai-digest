import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { fetchArticles } from './article-fetcher.js';
import { validatePublicHttpUrl } from './url-policy.js';
import { rankArticlesWithCodex } from './digest-agent.js';
import { discoverDigest } from './discovery.js';
import { createExecutionAuth } from './auth.js';

const requestSchema = z.object({
  sourceUrls: z.array(z.string().url()).min(1).max(10),
  themes: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  from: z.string().date().optional().or(z.literal('')),
  to: z.string().date().optional().or(z.literal(''))
});

const app = express();
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD is required in production');
}
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));

app.post('/api/digest/prepare', createExecutionAuth(process.env.ADMIN_PASSWORD), async (req, res) => {
  try {
    const input = requestSchema.parse(req.body);
    await Promise.all(input.sourceUrls.map(validatePublicHttpUrl));
    const progress = [];
    const digest = await discoverDigest(input, {
      prefetchArticles: fetchArticles,
      researchWithCodex: rankArticlesWithCodex
    }, (event) => progress.push(event));
    res.json({ articles: digest.candidates, automaticDigestUrls: digest.automaticDigestUrls, progress });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Не удалось подготовить дайджест' });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.listen(process.env.PORT || 3030, () => console.log('AI Digest running'));
