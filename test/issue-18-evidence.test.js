import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchArticleEvidence, requiresImplementationEvidence, verifyFetchedEvidence } from '../src/evidence.js';
import { FetchSourceError } from '../src/article-fetcher.js';

const url = 'https://example.com/article';
const quote = 'Acme deployed the Nova platform in production to process customer orders.';
const article = { url, publishedAt: '2026-09-10', evidence: { organization: 'Acme', technology: 'Nova platform', implementation: 'process customer orders', quote } };
const page = { status: 'fetched', url, publishedAt: '2026-09-10', text: `Report: ${quote}` };

test('verifies exact fetched excerpt and classifies implementation stage conservatively', () => {
  const result = verifyFetchedEvidence(article, page);
  assert.equal(result.verification, 'fetched_verified');
  assert.equal(result.autoEligible, true);
  assert.equal(result.evidence.stage, 'operation');
  assert.equal(result.evidence.excerpt, quote);
  assert.equal(result.evidence.dateProvenance, 'fetched_article_metadata_utc');
});

test('rejects invented excerpt, unconfirmed date, listing and blocked pages', async () => {
  assert.equal(verifyFetchedEvidence({ ...article, evidence: { ...article.evidence, quote: 'Acme has deployed an entirely different platform for millions of users.' } }, page).verification, 'search_evidence_only');
  assert.equal(verifyFetchedEvidence(article, { ...page, publishedAt: '2026-09-11' }).autoEligible, false);
  assert.equal(verifyFetchedEvidence(article, { ...page, status: 'listing' }).autoEligible, false);
  const blocked = await fetchArticleEvidence(article, async () => { throw Object.assign(new Error('blocked'), { status: 'blocked' }); });
  assert.equal(blocked.verification, 'unverified');
  assert.equal(blocked.fetchStatus, 'blocked');
});

test('distinguishes announcement from pilot evidence and only activates for matching prompts', () => {
  const announcement = verifyFetchedEvidence({ ...article, evidence: { ...article.evidence, quote: 'Acme announced plans to deploy the Nova platform to process customer orders.' } }, { ...page, text: 'Acme announced plans to deploy the Nova platform to process customer orders.' });
  assert.equal(announcement.evidence.stage, 'announcement');
  assert.equal(announcement.verification, 'fetched_verified');
  assert.equal(announcement.autoEligible, false);
  const pilotQuote = 'Acme is piloting the Nova platform to process customer orders.';
  const pilot = verifyFetchedEvidence({ ...article, evidence: { ...article.evidence, quote: pilotQuote } }, { ...page, text: pilotQuote });
  assert.equal(pilot.evidence.stage, 'pilot');
  assert.equal(requiresImplementationEvidence('AI and market trends'), false);
  assert.equal(requiresImplementationEvidence('Только фактическое внедрение'), true);
});

test('article fixtures distinguish deployed, listing, 404, blocked, undated, and invented-quote pages', async () => {
  const deployedHtml = `<main><article><time datetime="2026-09-10"></time><p>${quote}</p></article></main>`;
  const deployed = await fetchArticleEvidence(article, async () => ({ url, html: deployedHtml }));
  assert.equal(deployed.verification, 'fetched_verified');
  assert.equal(deployed.evidence.url, url);
  const announcementText = 'Acme announced plans to deploy the Nova platform to process customer orders.';
  const announcement = await fetchArticleEvidence({ ...article, evidence: { ...article.evidence, quote: announcementText } }, async () => ({ url, html: `<main><article><time datetime="2026-09-10"></time><p>${announcementText}</p></article></main>` }));
  assert.equal(announcement.evidence.stage, 'announcement');
  assert.equal(announcement.autoEligible, false);
  const listing = await fetchArticleEvidence(article, async () => ({ url, html: '<main><h1>News</h1><a href="/article">A long listing link, but not an article.</a></main>' }));
  assert.equal(listing.verification, 'unverified');
  assert.equal(listing.fetchStatus, 'listing');
  const missing = await fetchArticleEvidence(article, async () => { throw new FetchSourceError('http_error', '404'); });
  assert.equal(missing.verification, 'unverified');
  assert.equal(missing.fetchStatus, 'http_error');
  const blocked = await fetchArticleEvidence(article, async () => { throw new FetchSourceError('blocked', 'private redirect'); });
  assert.equal(blocked.fetchStatus, 'blocked');
  const undated = await fetchArticleEvidence(article, async () => ({ url, html: `<main><article><p>${quote}</p></article></main>` }));
  assert.equal(undated.autoEligible, false);
  const invented = await fetchArticleEvidence({ ...article, evidence: { ...article.evidence, quote: 'This invented claim is not contained in the fetched article at all.' } }, async () => ({ url, html: deployedHtml }));
  assert.equal(invented.verification, 'search_evidence_only');
  assert.equal(invented.evidence.excerpt, null);
});
