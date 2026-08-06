import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codexOutputSchema,
  normalizeCodexUsage,
  aggregateCodexUsage,
  rankArticlesWithCodex
} from '../src/digest-agent.js';

test('codexOutputSchema requires outcome and checkedCount fields', () => {
  const schema = codexOutputSchema();
  assert.ok(schema.required.includes('outcome'));
  assert.ok(schema.required.includes('checkedCount'));
  assert.equal(schema.properties.checkedCount.type, 'integer');
  assert.deepEqual(schema.properties.outcome.enum, [
    'researched',
    'no_relevant_articles',
    'unreachable_from_research',
    'blocked',
    'unsupported'
  ]);
});

test('aggregateCodexUsage correctly sums token dimensions across runs', () => {
  const usage1 = {
    available: true,
    inputTokens: 100,
    cachedInputTokens: 20,
    cacheWriteInputTokens: 10,
    outputTokens: 50,
    reasoningOutputTokens: 15
  };
  const usage2 = {
    available: true,
    inputTokens: 200,
    cachedInputTokens: 30,
    cacheWriteInputTokens: 15,
    outputTokens: 80,
    reasoningOutputTokens: 25
  };
  const aggregated = aggregateCodexUsage([usage1, usage2]);
  assert.deepEqual(aggregated, {
    available: true,
    inputTokens: 300,
    cachedInputTokens: 50,
    cacheWriteInputTokens: 25,
    outputTokens: 130,
    reasoningOutputTokens: 40
  });

  assert.deepEqual(aggregateCodexUsage([usage1, { available: false }]), { available: false });
});

test('rankArticlesWithCodex produces per-source coverage for two sources with different outcomes', async () => {
  const mockRun = async ({ sourceUrl }) => {
    if (sourceUrl.includes('/source-a')) {
      return {
        candidates: [{ title: 'Article A', url: 'https://example.com/source-a/post-1', publishedAt: '2026-08-05', reason: 'Relevant topic' }],
        automaticDigestUrls: ['https://example.com/source-a/post-1'],
        checkedCount: 5,
        outcome: 'researched'
      };
    }
    return {
      candidates: [],
      automaticDigestUrls: [],
      checkedCount: 3,
      outcome: 'no_relevant_articles'
    };
  };

  const result = await rankArticlesWithCodex({
    articles: [],
    sourceUrls: ['https://example.com/source-a', 'https://example.com/source-b'],
    themes: ['AI'],
    from: '2026-08-01',
    to: '2026-08-06',
    _mockRun: mockRun
  });

  assert.equal(result.researchSources.length, 2);

  const sourceA = result.researchSources.find(s => s.url === 'https://example.com/source-a');
  assert.equal(sourceA.outcome, 'researched');
  assert.equal(sourceA.checkedCount, 5);
  assert.equal(sourceA.foundCount, 1);
  assert.equal(sourceA.error, null);

  const sourceB = result.researchSources.find(s => s.url === 'https://example.com/source-b');
  assert.equal(sourceB.outcome, 'no_relevant_articles');
  assert.equal(sourceB.checkedCount, 3);
  assert.equal(sourceB.foundCount, 0);
  assert.equal(sourceB.error, null);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].url, 'https://example.com/source-a/post-1');
});

test('rankArticlesWithCodex handles partial failure during research without dropping other sources', async () => {
  const mockRun = async ({ sourceUrl }) => {
    if (sourceUrl.includes('/good')) {
      return {
        candidates: [{ title: 'Good News', url: 'https://example.com/good/item-1', publishedAt: '2026-08-04', reason: 'Verified' }],
        automaticDigestUrls: [],
        checkedCount: 4,
        outcome: 'researched'
      };
    }
    throw new Error('Codex connection reset for source');
  };

  const result = await rankArticlesWithCodex({
    articles: [],
    sourceUrls: ['https://example.com/good', 'https://example.com/unreachable'],
    themes: [],
    _mockRun: mockRun
  });

  assert.equal(result.researchSources.length, 2);

  const good = result.researchSources.find(s => s.url === 'https://example.com/good');
  assert.equal(good.outcome, 'researched');
  assert.equal(good.foundCount, 1);

  const failed = result.researchSources.find(s => s.url === 'https://example.com/unreachable');
  assert.equal(failed.outcome, 'unreachable_from_research');
  assert.equal(failed.checkedCount, null);
  assert.equal(failed.foundCount, 0);
  assert.equal(failed.error, 'Source research failed; see server logs for details');

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].url, 'https://example.com/good/item-1');
});

test('rankArticlesWithCodex filters out candidates from disallowed hostnames', async () => {
  const mockRun = async () => ({
    candidates: [
      { title: 'Official', url: 'https://official.gov.ru/news/1', publishedAt: '2026-08-05', reason: 'Good' },
      { title: 'Untrusted Mirror', url: 'https://untrusted-spam.com/news/1', publishedAt: '2026-08-05', reason: 'Bad' }
    ],
    automaticDigestUrls: ['https://official.gov.ru/news/1', 'https://untrusted-spam.com/news/1'],
    checkedCount: 2,
    outcome: 'researched'
  });

  const result = await rankArticlesWithCodex({
    articles: [],
    sourceUrls: ['https://official.gov.ru/news'],
    themes: [],
    _mockRun: mockRun
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].url, 'https://official.gov.ru/news/1');
  assert.deepEqual(result.automaticDigestUrls, ['https://official.gov.ru/news/1']);
});

test('rankArticlesWithCodex deduplicates identical article URLs across multiple sources', async () => {
  const mockRun = async ({ sourceUrl }) => ({
    candidates: [
      { title: 'Shared Item', url: 'https://example.com/shared-1', publishedAt: '2026-08-02', reason: 'Shared' }
    ],
    automaticDigestUrls: ['https://example.com/shared-1'],
    checkedCount: 1,
    outcome: 'researched'
  });

  const result = await rankArticlesWithCodex({
    articles: [],
    sourceUrls: ['https://example.com/page-1', 'https://example.com/page-2'],
    themes: [],
    _mockRun: mockRun
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].url, 'https://example.com/shared-1');
  assert.deepEqual(result.automaticDigestUrls, ['https://example.com/shared-1']);
});
