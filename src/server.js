import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { fetchArticles } from './article-fetcher.js';
import { rankArticlesWithCodex } from './digest-agent.js';
import { filterArticlesByDate } from './digest-result.js';

const requestSchema = z.object({
  sourceUrls: z.array(z.string().url()).min(1).max(10),
  themes: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  from: z.string().date().optional().or(z.literal('')),
  to: z.string().date().optional().or(z.literal(''))
});

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));

app.post('/api/digest/prepare', async (req, res) => {
  try {
    const input = requestSchema.parse(req.body);
    const fetched = await fetchArticles(input.sourceUrls);
    const articles = filterArticlesByDate(fetched, input.from, input.to);
    if (!articles.length) return res.status(422).json({ error: 'По этим источникам и датам не нашлось ссылок на статьи.' });
    const digest = await rankArticlesWithCodex({ ...input, articles });
    res.json({ articles: digest.candidates, automaticDigestUrls: digest.automaticDigestUrls });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Не удалось подготовить дайджест' });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.listen(process.env.PORT || 3030, () => console.log('AI Digest running'));
