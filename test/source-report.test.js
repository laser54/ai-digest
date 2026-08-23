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
  assert.equal(formatSourceStatus('reauthentication_required'), 'Требуется повторный вход Codex');
  assert.equal(formatSourceStatus('unsupported'), 'Не поддерживается');
  assert.equal(formatSourceStatus('unknown'), 'Неизвестный статус');
});

test('sourceReportSummary separates AI outcomes, candidates, and optional prefetch limitations', () => {
  const sources = Array.from({ length: 7 }, (_, index) => ({
    url: `https://source-${index}.example/news`,
    status: index < 2 ? 'fetched' : 'http_error',
    articles: [],
    error: index < 2 ? null : 'http_error'
  }));
  const researchSources = sources.map((source, index) => ({
    url: source.url,
    outcome: index === 6 ? 'no_relevant_articles' : 'researched',
    foundCount: [5, 5, 4, 4, 4, 4, 0][index]
  }));

  const summary = sourceReportSummary(sources, researchSources);
  assert.deepEqual(summary, {
    totalCount: 7,
    aiAvailableCount: 7,
    aiUnavailableCount: 0,
    candidateCount: 26,
    prefetchAvailableCount: 2,
    prefetchLimitedCount: 5,
    message: 'Источники: 7 · AI успешно: 7, AI недоступен: 0 · найдено кандидатов: 26 · предзагрузка доступна: 2, ограничена: 5. При ограничениях предзагрузки AI-исследование продолжилось.'
  });
  assert.doesNotMatch(summary.message, /с ошибкой: 5/);
});

test('sourceReportSummary reports partial AI failure honestly', () => {
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
  assert.equal(summary.aiAvailableCount, 1);
  assert.equal(summary.aiUnavailableCount, 1);
  assert.equal(summary.candidateCount, 1);
  assert.equal(summary.prefetchAvailableCount, 1);
  assert.equal(summary.prefetchLimitedCount, 1);
  assert.match(summary.message, /AI успешно: 1, AI недоступен: 1/);
});

test('sourceReportSummary reports all AI sources unavailable', () => {
  const researchSources = [
    { url: 'https://a.example', outcome: 'blocked', foundCount: 0 },
    { url: 'https://b.example', outcome: 'unsupported', foundCount: 0 }
  ];
  const summary = sourceReportSummary([], researchSources);
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.aiAvailableCount, 0);
  assert.equal(summary.aiUnavailableCount, 2);
  assert.match(summary.message, /AI успешно: 0, AI недоступен: 2/);
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
      append(...children) { this._children.push(...children); },
      replaceChildren() { this._children = []; }
    };
  }
  return { createElement: (tag) => makeNode(tag) };
}

const collectText = (node) => {
  let out = String(node.textContent || '');
  for (const child of node._children || []) out += ' ' + collectText(child);
  return out;
};

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

    const allText = container._children.map(collectText).join(' ');

    assert.equal(allText.includes('user:hidden'), false, 'URL credentials must not appear in rendered DOM');
    assert.equal(allText.includes('token=abc'), false, 'query string must not appear in rendered DOM');
    assert.equal(allText.includes('example.com'), true, 'hostname is allowed');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('renderSourceReport humanizes statuses and suppresses only redundant raw errors', () => {
  const originalDocument = globalThis.document;
  globalThis.document = makeShimDocument();
  try {
    const sources = [
      { url: 'https://a.example', status: 'http_error', articles: [], error: 'http_error' },
      { url: 'https://b.example', status: 'too_large', articles: [], error: 'Upstream returned a distinct explanation' }
    ];
    const researchSources = sources.map(({ url }) => ({ url, outcome: 'researched', foundCount: 1 }));
    const container = document.createElement('section');
    renderSourceReport(container, sources, researchSources);
    const allText = collectText(container);

    assert.match(allText, /Предзагрузка: Ошибка HTTP/);
    assert.doesNotMatch(allText, /http_error/);
    assert.match(allText, /Upstream returned a distinct explanation/);
    assert.equal(container._children[1]._children[0].className.includes('ai-success'), true);
  } finally {
    globalThis.document = originalDocument;
  }
});
