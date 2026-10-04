import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverDigest } from '../src/discovery.js';

test('implementation-filtered discovery verifies pages before automatic selection', async () => {
  const verifiedUrl = 'https://example.com/verified';
  const unverifiedUrl = 'https://example.com/unverified';
  let checks = 0;
  const result = await discoverDigest({ sourceUrls: ['https://example.com'], themes: [], editorialPrompt: 'Только фактическое внедрение' }, {
    prefetchArticles: async () => [],
    researchWithCodex: async () => ({
      candidates: [{ url: verifiedUrl, publishedAt: '2026-09-10' }, { url: unverifiedUrl, publishedAt: '2026-09-10' }],
      automaticDigestUrls: [verifiedUrl, unverifiedUrl]
    }),
    verifyArticleEvidence: async (candidate) => {
      checks += 1;
      return candidate.url === verifiedUrl
        ? { verification: 'fetched_verified', autoEligible: true, evidence: { organization: 'Acme', technology: 'Nova', implementation: 'deployed', stage: 'operation', excerpt: 'exact text', url: verifiedUrl, publishedAt: '2026-09-10' } }
        : { verification: 'unverified', evidence: null };
    }
  });
  assert.equal(checks, 2);
  assert.deepEqual(result.automaticDigestUrls, [verifiedUrl]);
  assert.equal(result.candidates.find((candidate) => candidate.url === unverifiedUrl).verification, 'unverified');
});
