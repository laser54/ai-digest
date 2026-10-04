import test from 'node:test';
import assert from 'node:assert/strict';
import { renderArticleCard } from '../public/article-card.js';

function makeDocument() {
  const makeNode = (tagName) => ({ tagName, children: [], textContent: '', append(...children) { this.children.push(...children); } });
  return { createElement: makeNode };
}
const collect = (node) => `${node.textContent || ''} ${(node.children || []).map(collect).join(' ')}`;
const walk = (node) => [node, ...(node.children || []).flatMap(walk)];

test('rendered article cards always show evidence fetch status and uncertainty without inventing excerpts', () => {
  const originalDocument = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const cases = [
      { fetchStatus: 'blocked', expected: 'blocked' },
      { fetchStatus: '404', expected: '404' },
      { fetchStatus: 'listing', expected: 'listing' }
    ];
    for (const item of cases) {
      const card = renderArticleCard({ title: 'Example', url: 'https://example.com/a', reason: 'why', verification: 'unverified', evidence: null, fetchStatus: item.fetchStatus });
      const text = collect(card);
      assert.match(text, new RegExp(item.expected));
      assert.match(text, /Неопределённость/);
      assert.doesNotMatch(text, /цитата|доказательство: invented/i);
    }
    const verified = renderArticleCard({ title: 'Verified', url: 'https://example.com/b', publishedAt: '2026-10-01', reason: 'source reason', verification: 'fetched_verified', evidence: { organization: 'Acme', technology: 'Nova', implementation: 'deployed', stage: 'operation', excerpt: 'exact fetched excerpt', url: 'https://example.com/b', dateProvenance: 'fetched_article_metadata_utc' }, fetchStatus: 'fetched', claimConfidence: 'medium', dateConfidence: 'high' });
    const text = collect(verified);
    for (const value of ['Acme', 'Nova', 'deployed', 'operation', 'exact fetched excerpt', 'fetched', 'source reason', 'medium', 'high']) assert.ok(text.includes(value), value);
    const link = walk(verified).find((node) => node.tagName === 'a');
    assert.equal(link.href, 'https://example.com/b');
  } finally { globalThis.document = originalDocument; }
});

test('rendered article cards never create a script link from tampered durable history', () => {
  const originalDocument = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const card = renderArticleCard({ title: 'hostile', url: 'javascript:alert(1)', reason: 'manual', verification: 'unverified', evidence: null });
    assert.equal(walk(card).some((node) => node.tagName === 'a'), false);
    assert.match(collect(card), /Уверенность в утверждении: независимо не оценена/);
    assert.doesNotMatch(collect(card), /javascript:alert/);
  } finally { globalThis.document = originalDocument; }
});
