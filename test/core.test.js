import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicHttpUrl } from '../src/url-policy.js';
import { normalizeAgentResult, filterArticlesByDate } from '../src/digest-result.js';
import {
  CODEX_DISCOVERY_FALLBACK_MODEL,
  CODEX_DISCOVERY_LUNA_MODEL,
  codexThreadOptions,
  codexOutputSchema,
  normalizeCodexUsage,
  selectDiscoveryModel
} from '../src/digest-agent.js';
import { discoverDigest } from '../src/discovery.js';

test('runs Codex from a container checkout without requiring a Git directory', () => {
  assert.equal(codexThreadOptions().skipGitRepoCheck, true);
});

test('enables Codex web tools for source discovery', () => {
  assert.equal(codexThreadOptions().networkAccessEnabled, true);
  assert.equal(codexThreadOptions().webSearchEnabled, true);
});

test('selects the verified Luna model by default and only permits the safe fallback override', () => {
  assert.equal(CODEX_DISCOVERY_LUNA_MODEL, 'gpt-5.6-luna');
  assert.equal(CODEX_DISCOVERY_FALLBACK_MODEL, 'gpt-5.6-terra');
  assert.equal(selectDiscoveryModel({}), CODEX_DISCOVERY_LUNA_MODEL);
  assert.equal(selectDiscoveryModel({ CODEX_DISCOVERY_MODEL: CODEX_DISCOVERY_FALLBACK_MODEL }), CODEX_DISCOVERY_FALLBACK_MODEL);
  assert.equal(selectDiscoveryModel({ CODEX_DISCOVERY_MODEL: 'unverified-model' }), CODEX_DISCOVERY_LUNA_MODEL);
});

test('passes the selected discovery model to Codex thread configuration', () => {
  assert.equal(codexThreadOptions().model, CODEX_DISCOVERY_LUNA_MODEL);
  assert.equal(codexThreadOptions(CODEX_DISCOVERY_FALLBACK_MODEL).model, CODEX_DISCOVERY_FALLBACK_MODEL);
});

test('declares every Codex candidate schema field as required', () => {
  assert.deepEqual(codexOutputSchema().properties.candidates.items.required, ['url', 'title', 'publishedAt', 'reason']);
});

test('reports only complete, documented Codex usage values and marks absent or malformed usage unavailable', () => {
  assert.deepEqual(normalizeCodexUsage({
    input_tokens: 12,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: 5,
    reasoning_output_tokens: 7
  }), {
    available: true,
    inputTokens: 12,
    cachedInputTokens: 3,
    cacheWriteInputTokens: 2,
    outputTokens: 5,
    reasoningOutputTokens: 7
  });
  assert.deepEqual(normalizeCodexUsage(null), { available: false });
  assert.deepEqual(normalizeCodexUsage({ input_tokens: 12 }), { available: false });
  assert.deepEqual(normalizeCodexUsage({
    input_tokens: 12,
    cached_input_tokens: 3,
    cache_write_input_tokens: 2,
    output_tokens: -5,
    reasoning_output_tokens: 7
  }), { available: false });
});

test('rejects non-public and credential-bearing source URLs before fetching', async () => {
  await assert.rejects(() => validatePublicHttpUrl('http://127.0.0.1/admin'));
  await assert.rejects(() => validatePublicHttpUrl('http://169.254.169.254/latest/meta-data'));
  await assert.rejects(() => validatePublicHttpUrl('https://user:pass@example.com/news'));
});

test('normalizes an agent response to unique candidates from fetched articles only', () => {
  const allowed = [
    { title: 'First', url: 'https://example.com/first', publishedAt: '2026-08-01' },
    { title: 'Second', url: 'https://example.com/second', publishedAt: '2026-08-02' }
  ];

  const result = normalizeAgentResult({
    candidates: [
      { title: 'First revised', url: 'https://example.com/first', reason: 'Relevant' },
      { title: 'Invented', url: 'https://other.example/invented', reason: 'No' },
      { title: 'First duplicate', url: 'https://example.com/first', reason: 'Duplicate' },
      { title: 'Second', url: 'https://example.com/second', reason: 'Relevant too' }
    ],
    automaticDigestUrls: ['https://example.com/second', 'https://other.example/invented']
  }, allowed);

  assert.deepEqual(result.candidates, [
    { title: 'First', url: 'https://example.com/first', publishedAt: '2026-08-01', reason: 'Relevant' },
    { title: 'Second', url: 'https://example.com/second', publishedAt: '2026-08-02', reason: 'Relevant too' }
  ]);
  assert.deepEqual(result.automaticDigestUrls, ['https://example.com/second']);
});

test('keeps Codex-discovered articles only when their host was explicitly supplied by the user', () => {
  const result = normalizeAgentResult({
    candidates: [
      { title: 'Official news', url: 'https://rosenergo.gov.ru/press-center/news/item-1', publishedAt: '2026-08-03', reason: 'Relevant' },
      { title: 'Untrusted mirror', url: 'https://example.org/copied-item', reason: 'No' }
    ],
    automaticDigestUrls: ['https://rosenergo.gov.ru/press-center/news/item-1', 'https://example.org/copied-item']
  }, [], ['https://rosenergo.gov.ru/press-center/news']);
  assert.deepEqual(result.candidates, [{
    title: 'Official news', url: 'https://rosenergo.gov.ru/press-center/news/item-1', publishedAt: '2026-08-03', reason: 'Relevant'
  }]);
  assert.deepEqual(result.automaticDigestUrls, ['https://rosenergo.gov.ru/press-center/news/item-1']);
});

test('keeps dated articles within the requested inclusive date window and retains undated candidates', () => {
  const articles = [
    { title: 'Old', url: 'https://example.com/old', publishedAt: '2026-07-31' },
    { title: 'Current', url: 'https://example.com/current', publishedAt: '2026-08-02' },
    { title: 'Unknown date', url: 'https://example.com/unknown', publishedAt: null }
  ];
  assert.deepEqual(filterArticlesByDate(articles, '2026-08-01', '2026-08-03').map(({ title }) => title), ['Current', 'Unknown date']);
});

test('discovery reports determinate source and candidate-link progress without estimating opaque Codex work', async () => {
  const events = [];
  const input = {
    sourceUrls: ['https://example.com/news'],
    themes: ['AI'],
    from: '2026-08-01',
    to: '2026-08-03'
  };
  const digest = await discoverDigest(input, {
    prefetchArticles: async () => { throw new Error('source unavailable'); },
    researchWithCodex: async (request) => {
      assert.deepEqual(request.sourceUrls, input.sourceUrls);
      assert.deepEqual(request.articles, []);
      return {
        candidates: [{ title: 'Verified', url: 'https://example.com/news/verified', publishedAt: '2026-08-02', reason: 'AI' }],
        automaticDigestUrls: ['https://example.com/news/verified']
      };
    }
  }, (event) => events.push(event));

  assert.deepEqual(events, [
    { phase: 'prefetching', sourceCount: 1 },
    { phase: 'prefetched', sourceCount: 1, candidateLinkCount: 0 },
    { phase: 'researching', sourceCount: 1, candidateLinkCount: 0, sourceHosts: ['example.com'] },
    { phase: 'complete', sourceCount: 1, candidateCount: 1 }
  ]);
  assert.equal(digest.candidates[0].url, 'https://example.com/news/verified');
  assert.deepEqual(digest.sources, []);
});

test('exposes typed per-source status in the final digest result without leaking it into progress events', async () => {
  const events = [];
  const input = { sourceUrls: ['https://example.com/a', 'https://example.com/b'], themes: [], from: '', to: '' };
  const digest = await discoverDigest(input, {
    prefetchArticles: async () => ({
      articles: [],
      sources: [
        { url: 'https://example.com/a', status: 'fetched', articles: [{ title: 'A', url: 'https://example.com/a/x', publishedAt: null, sourceUrl: 'https://example.com/a', sourceHost: 'example.com' }], error: null },
        { url: 'https://example.com/b', status: 'http_error', articles: [], error: 'HTTP 500' }
      ]
    }),
    researchWithCodex: async () => ({ candidates: [], automaticDigestUrls: [] })
  }, (event) => events.push(event));

  for (const ev of events) {
    assert.equal('sources' in ev, false, `progress event ${ev.phase} must not include sources`);
  }
  assert.equal(digest.sources.length, 2);
  assert.equal(digest.sources[0].status, 'fetched');
  assert.equal(digest.sources[1].status, 'http_error');
});
