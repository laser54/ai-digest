import test from 'node:test';
import assert from 'node:assert/strict';
import { articleSourceLabel, createArticleSource } from '../public/article-presentation.js';

test('article source attribution exposes only a verified URL hostname', () => {
  assert.equal(articleSourceLabel('https://user:secret@news.example:8443/private/story?token=abc#part'), 'Источник: news.example');
  assert.equal(articleSourceLabel('not a URL'), 'Источник: неизвестен');
});

test('candidate and final renderers can share a safe visible source presentation node', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ className: '', textContent: '' }) };
  try {
    for (const context of ['candidate', 'digest']) {
      const node = createArticleSource('https://user:secret@news.example/path?q=1', context);
      assert.equal(node.textContent, 'Источник: news.example');
      assert.equal(node.className, `article-source article-source-${context}`);
    }
  } finally {
    globalThis.document = originalDocument;
  }
});
