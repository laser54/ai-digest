import test from 'node:test';
import assert from 'node:assert/strict';
import { rankArticlesWithCodex } from '../src/digest-agent.js';

function makeStuckMock() {
  return async () => {
    return new Promise(() => {
      // never resolves
    });
  };
}

function makeFastMock(results) {
  return async ({ sourceUrl }) => {
    const r = results[sourceUrl] || { candidates: [], automaticDigestUrls: [], checkedCount: 0, outcome: 'no_relevant_articles' };
    return r;
  };
}

test('rankArticlesWithCodex uses a bounded 120-second production default', async () => {
  const previous = process.env.CODEX_RESEARCH_TIMEOUT_MS;
  delete process.env.CODEX_RESEARCH_TIMEOUT_MS;
  try {
    const result = await rankArticlesWithCodex({ sourceUrls: [] });

    assert.equal(result.researchTimeoutMs, 120_000);
    assert.ok(Number.isFinite(result.researchTimeoutMs));
  } finally {
    if (previous !== undefined) process.env.CODEX_RESEARCH_TIMEOUT_MS = previous;
  }
});

test('rankArticlesWithCodex keeps the bounded default for an invalid timeout override', async () => {
  const previous = process.env.CODEX_RESEARCH_TIMEOUT_MS;
  process.env.CODEX_RESEARCH_TIMEOUT_MS = 'unbounded';
  try {
    const result = await rankArticlesWithCodex({ sourceUrls: [] });

    assert.equal(result.researchTimeoutMs, 120_000);
  } finally {
    if (previous === undefined) delete process.env.CODEX_RESEARCH_TIMEOUT_MS;
    else process.env.CODEX_RESEARCH_TIMEOUT_MS = previous;
  }
});

test('rankArticlesWithCodex runs at most two source researches and preserves input order', async () => {
  const sourceUrls = [1, 2, 3, 4, 5].map((id) => `https://${id}.example.com/news`);
  let active = 0;
  let maxActive = 0;
  const result = await rankArticlesWithCodex({
    sourceUrls,
    _mockRun: async ({ sourceUrl }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, sourceUrl.includes('2.') ? 5 : 20));
      active -= 1;
      return { candidates: [], automaticDigestUrls: [], checkedCount: 1, outcome: 'no_relevant_articles' };
    }
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(result.researchSources.map(({ url }) => url), sourceUrls);
});

test('rankArticlesWithCodex aborts a timed-out run and keeps the typed timeout result', async () => {
  let aborted = false;
  const result = await rankArticlesWithCodex({
    sourceUrls: ['https://stuck.example.com/news'],
    _timeoutMs: 20,
    _mockRun: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted after timeout', 'AbortError'));
      }, { once: true });
    })
  });

  assert.equal(aborted, true);
  assert.equal(result.researchSources[0].errorName, 'CodexResearchTimeout');
  assert.equal(result.researchSources[0].error, 'Source research timed out');
});

test('rankArticlesWithCodex times out a single stuck source and marks it unreachable_from_research', async () => {
  const start = Date.now();
  const result = await rankArticlesWithCodex({
    articles: [],
    sourceUrls: ['https://stuck.example.com/news'],
    themes: [],
    from: '',
    to: '',
    _mockRun: makeStuckMock(),
    _timeoutMs: 200
  });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `must return promptly after timeout, took ${elapsed}ms`);
  assert.equal(result.researchSources.length, 1);
  assert.equal(result.researchSources[0].outcome, 'unreachable_from_research');
  assert.equal(result.researchSources[0].errorName, 'CodexResearchTimeout');
  assert.equal(result.researchSources[0].checkedCount, null);
  assert.equal(result.candidates.length, 0);
});

test('rankArticlesWithCodex times out all stuck sources but keeps the response shape', async () => {
  const result = await rankArticlesWithCodex({
    articles: [],
    sourceUrls: [
      'https://a.example.com/news',
      'https://b.example.com/news',
      'https://c.example.com/news'
    ],
    themes: [],
    from: '',
    to: '',
    _mockRun: makeStuckMock(),
    _timeoutMs: 150
  });
  assert.equal(result.researchSources.length, 3);
  for (const s of result.researchSources) {
    assert.equal(s.outcome, 'unreachable_from_research');
    assert.equal(s.errorName, 'CodexResearchTimeout');
  }
  assert.equal(result.candidates.length, 0);
});

test('rankArticlesWithCodex does not time out fast sources and lets them return their own outcome', async () => {
  const result = await rankArticlesWithCodex({
    articles: [],
    sourceUrls: [
      'https://a.example.com/news',
      'https://b.example.com/news'
    ],
    themes: [],
    from: '',
    to: '',
    _mockRun: makeFastMock({
      'https://a.example.com/news': {
        candidates: [{ title: 'A', url: 'https://a.example.com/x', publishedAt: '2026-08-01', reason: 'ok' }],
        automaticDigestUrls: ['https://a.example.com/x'],
        checkedCount: 3,
        outcome: 'researched'
      },
      'https://b.example.com/news': {
        candidates: [],
        automaticDigestUrls: [],
        checkedCount: 0,
        outcome: 'no_relevant_articles'
      }
    }),
    _timeoutMs: 1000
  });
  assert.equal(result.researchSources.length, 2);
  const a = result.researchSources.find((s) => s.url === 'https://a.example.com/news');
  const b = result.researchSources.find((s) => s.url === 'https://b.example.com/news');
  assert.equal(a.outcome, 'researched');
  assert.equal(a.checkedCount, 3);
  assert.equal(b.outcome, 'no_relevant_articles');
  assert.equal(b.checkedCount, 0);
});

test('rankArticlesWithCodex honors a short CODEX_RESEARCH_TIMEOUT_MS env override', async () => {
  const previous = process.env.CODEX_RESEARCH_TIMEOUT_MS;
  process.env.CODEX_RESEARCH_TIMEOUT_MS = '120';
  try {
    const start = Date.now();
    const result = await rankArticlesWithCodex({
      articles: [],
      sourceUrls: ['https://stuck.example.com/news'],
      themes: [],
      from: '',
      to: '',
      _mockRun: makeStuckMock()
    });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 3000, `must return within env-configured timeout, took ${elapsed}ms`);
    assert.equal(result.researchSources[0].outcome, 'unreachable_from_research');
    assert.equal(result.researchSources[0].errorName, 'CodexResearchTimeout');
    assert.equal(result.timedOutSourceCount, 1);
    assert.equal(result.researchTimeoutMs, 120);
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_RESEARCH_TIMEOUT_MS;
    } else {
      process.env.CODEX_RESEARCH_TIMEOUT_MS = previous;
    }
  }
});
