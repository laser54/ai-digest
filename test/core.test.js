import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicHttpUrl } from '../src/url-policy.js';
import { normalizeAgentResult, filterArticlesByDate } from '../src/digest-result.js';

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

test('keeps dated articles within the requested inclusive date window and retains undated candidates', () => {
  const articles = [
    { title: 'Old', url: 'https://example.com/old', publishedAt: '2026-07-31' },
    { title: 'Current', url: 'https://example.com/current', publishedAt: '2026-08-02' },
    { title: 'Unknown date', url: 'https://example.com/unknown', publishedAt: null }
  ];
  assert.deepEqual(filterArticlesByDate(articles, '2026-08-01', '2026-08-03').map(({ title }) => title), ['Current', 'Unknown date']);
});
