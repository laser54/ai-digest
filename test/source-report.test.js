import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSourceStatus,
  sourceReportSummary,
  buildSourceReportData,
  renderSourceReport
} from '../public/source-report.js';

test('formatSourceStatus translates raw statuses into clear readable labels', () => {
  assert.equal(formatSourceStatus('fetched'), 'Успешно загружен');
  assert.equal(formatSourceStatus('no_articles'), 'Статей не найдено');
  assert.equal(formatSourceStatus('timeout'), 'Таймаут');
  assert.equal(formatSourceStatus('http_error'), 'Ошибка HTTP');
  assert.equal(formatSourceStatus('non_html'), 'Не-HTML контент');
  assert.equal(formatSourceStatus('redirect_error'), 'Ошибка редиректа');
  assert.equal(formatSourceStatus('blocked'), 'Заблокирован (SSRF)');
  assert.equal(formatSourceStatus('blocked', 'research'), 'Заблокирован (AI)');
  assert.equal(formatSourceStatus('too_large'), 'Превышен размер (>1.5 МБ)');
  assert.equal(formatSourceStatus('researched'), 'Проверен AI');
  assert.equal(formatSourceStatus('no_relevant_articles'), 'Нет подходящих тем');
  assert.equal(formatSourceStatus('unreachable_from_research'), 'Недоступен для AI');
  assert.equal(formatSourceStatus('unsupported'), 'Не поддерживается');
  assert.equal(formatSourceStatus('unknown'), 'Неизвестный статус');
});

test('sourceReportSummary calculates accurate metrics for partial success and empty results', () => {
  const sources = [
    { url: 'https://example.com/a', status: 'fetched', articles: [{ title: 'A' }] },
    { url: 'https://example.com/b', status: 'http_error', articles: [], error: 'HTTP 500' }
  ];
  const researchSources = [
    { url: 'https://example.com/a', outcome: 'researched', checkedCount: 2, foundCount: 1 },
    { url: 'https://example.com/b', outcome: 'unreachable_from_research', checkedCount: 0, foundCount: 0 }
  ];

  const summary = sourceReportSummary(sources, researchSources);
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.fetchedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.researchedCount, 1);
  assert.match(summary.message, /Обработано источников: 2/);
  assert.match(summary.message, /успешно: 1/);
  assert.match(summary.message, /с ошибкой: 1/);
});

test('buildSourceReportData merges prefetch and research outcomes per source URL', async () => {
  const sources = [
    { url: 'https://example.com/news', status: 'fetched', articles: [{ title: 'Item 1' }] }
  ];
  const researchSources = [
    { url: 'https://example.com/news', outcome: 'researched', checkedCount: 5, foundCount: 1 }
  ];

  const report = buildSourceReportData(sources, researchSources);
  assert.equal(report.length, 1);
  assert.equal(report[0].hostname, 'example.com');
  assert.equal(report[0].prefetchStatus, 'fetched');
  assert.equal(report[0].researchOutcome, 'researched');
  assert.equal(report[0].candidateCount, 1);
});

// Minimal DOM shim for the renderSourceReport test. We do not need a full DOM;
// renderSourceReport only uses document.createElement and replaceChildren / append,
// and writes only via textContent / className / tagName.
function makeShimDocument() {
  function makeNode(tagName) {
    return {
      tagName,
      textContent: '',
      className: '',
      _children: [],
      append(child) { this._children.push(child); },
      replaceChildren() { this._children = []; }
    };
  }
  return { createElement: (tag) => makeNode(tag) };
}

test('renderSourceReport never leaks URL credentials into the DOM', () => {
  const originalDocument = globalThis.document;
  globalThis.document = makeShimDocument();
  try {
    const sources = [
      { url: 'https://user:hidden@example.com/news?token=abc#section', status: 'fetched', articles: [{ title: 'A' }] }
    ];
    const researchSources = [
      { url: 'https://user:hidden@example.com/news?token=abc#section', outcome: 'researched', checkedCount: 2, foundCount: 1 }
    ];

    const container = document.createElement('section');
    renderSourceReport(container, sources, researchSources);

    const collectText = (node) => {
      let out = String(node.textContent || '');
      for (const child of node._children || []) out += ' ' + collectText(child);
      return out;
    };
    const allText = container._children.map(collectText).join(' ');

    assert.equal(allText.includes('user:hidden'), false, 'URL credentials must not appear in rendered DOM');
    assert.equal(allText.includes('token=abc'), false, 'query string must not appear in rendered DOM');
    assert.equal(allText.includes('example.com'), true, 'hostname is allowed');
  } finally {
    globalThis.document = originalDocument;
  }
});
