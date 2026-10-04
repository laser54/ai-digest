import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationDate, filterArticlesByDate } from '../src/digest-result.js';
import { discoverDigest } from '../src/discovery.js';

test('publication dates use strict calendar validation and UTC timestamps', () => {
  assert.equal(publicationDate('2026-09-01'), '2026-09-01');
  assert.equal(publicationDate('2026-09-01T00:30:00+02:00'), '2026-08-31');
  assert.equal(publicationDate('2026-02-30'), null);
  assert.equal(publicationDate('2026-09-01 garbage'), null);
});

test('date gate excludes out-of-window articles and marks unknown dates for manual review', () => {
  const result = filterArticlesByDate([
    { url: 'old', publishedAt: '2020-01-01' },
    { url: 'from', publishedAt: '2026-09-01' },
    { url: 'to', publishedAt: '2026-09-12' },
    { url: 'future', publishedAt: '2026-09-13' },
    { url: 'unknown', publishedAt: null },
    { url: 'invalid', publishedAt: '2026-02-30' }
  ], '2026-09-01', '2026-09-12');
  assert.deepEqual(result.map((item) => item.url), ['from', 'to', 'unknown', 'invalid']);
  assert.deepEqual(result.slice(2).map((item) => item.dateStatus), ['unconfirmed', 'unconfirmed']);
});

test('final merged model candidates share the date gate and unknown dates are not automatic', async () => {
  const digest = await discoverDigest({ sourceUrls: ['https://example.com'], themes: [], from: '2026-09-01', to: '2026-09-12' }, {
    prefetchArticles: async () => [],
    researchWithCodex: async () => ({
      candidates: [
        { url: 'https://example.com/old', title: 'Old', publishedAt: '2020-01-01' },
        { url: 'https://example.com/current', title: 'Current', publishedAt: '2026-09-12' },
        { url: 'https://example.com/unknown', title: 'Unknown', publishedAt: null }
      ],
      automaticDigestUrls: ['https://example.com/old', 'https://example.com/current', 'https://example.com/unknown']
    })
  });
  assert.deepEqual(digest.candidates.map((item) => item.url), ['https://example.com/current', 'https://example.com/unknown']);
  assert.deepEqual(digest.automaticDigestUrls, ['https://example.com/current']);
});

test('prefetch and per-source counters reflect the post-merge date gate', async () => {
  const old = { url: 'https://example.com/old', publishedAt: '2020-01-01' };
  const current = { url: 'https://example.com/current', publishedAt: '2026-09-10' };
  const digest = await discoverDigest({ sourceUrls: ['https://example.com'], themes: [], from: '2026-09-01', to: '2026-09-12' }, {
    prefetchArticles: async () => ({ articles: [old, current], sources: [{ url: 'https://example.com', status: 'fetched', articles: [old, current] }] }),
    researchWithCodex: async () => ({ candidates: [old, current], automaticDigestUrls: [old.url, current.url], researchSources: [{ url: 'https://example.com', outcome: 'researched', foundCount: 2 }] })
  });
  assert.equal(digest.candidates.length, 1);
  assert.equal(digest.sources[0].articles.length, 1);
  assert.equal(digest.researchSources[0].foundCount, 1);
});
