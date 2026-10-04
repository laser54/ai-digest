import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('actual history refresh click does not submit the DOM event as a pagination cursor', async () => {
  const start = source.indexOf('async function refreshHistory(');
  const end = source.indexOf("document.querySelector('#execution-password').addEventListener", start);
  let click;
  let request;
  const context = {
    document: { querySelector: () => ({ addEventListener: (_type, handler) => { click = handler; } }) },
    historyRequest: async (_url, _method, body) => { request = body; return { items: [], nextCursor: null }; },
    historyList: { replaceChildren() {} }, historyStatus: {}, renderNextPageButton() {}
  };
  vm.runInNewContext(source.slice(start, end), context);
  await click({ type: 'click', isTrusted: true });
  assert.equal(request.limit, 20);
  assert.equal(request.cursor, undefined);
});

test('actual history request retains typed conflict code for recovery without hiding the error', async () => {
  const start = source.indexOf('async function historyRequest(');
  const end = source.indexOf('async function refreshHistory(', start);
  const context = {
    executionPassword: () => '',
    fetch: async () => ({ status: 409, ok: false, json: async () => ({ code: 'history_revision_conflict', error: 'Concurrent edit' }) })
  };
  vm.runInNewContext(source.slice(start, end), context);
  await assert.rejects(context.historyRequest('/api/digests/dig_fixture', 'PATCH', {}), (error) => error.code === 'history_revision_conflict' && error.message === 'Concurrent edit');
});

for (const scenario of ['clean', 'unsaved', 'switched']) {
  test(`actual retry completion refreshes cards without overwriting ${scenario} editor state`, async () => {
    const start = source.indexOf('async function trackRetry(');
    const end = source.indexOf("retryStart.addEventListener", start);
    const kept = { url: 'https://example.com/kept' };
    const recovered = { url: 'https://example.com/recovered' };
    const old = { id: 'dig_fixture', revision: 1, editorialDraft: 'saved', selectedUrls: [kept.url] };
    const fresh = { ...old, revision: 2, result: { articles: [kept, recovered], automaticDigestUrls: [] } };
    const draft = { value: scenario === 'unsaved' ? 'unsaved text' : 'saved' };
    let rendered = [];
    const context = {
      historyRecord: scenario === 'switched' ? { ...old, id: 'dig_other' } : old,
      historySaveChain: Promise.resolve(), delay: async () => {},
      historyRequest: async (url) => url.endsWith('/status') ? { status: 'complete' } : fresh,
      document: { querySelector: () => draft },
      candidates: { querySelectorAll: () => [{ value: kept.url }], replaceChildren: (...cards) => { rendered = cards; } },
      renderArticleCard: (article, options) => ({ url: article.url, selected: options.selected }),
      updateSelectedCount() {}, renderRetryPanel() {}, retryStatus: {},
    };
    vm.runInNewContext(source.slice(start, end), context);
    await context.trackRetry('job_fixture', 'dig_fixture');
    if (scenario === 'clean') {
      assert.equal(rendered.length, 2);
      assert.equal(rendered[0].selected, true);
      assert.equal(rendered[1].selected, false);
      assert.equal(context.historyRecord.revision, 2);
    } else {
      assert.equal(rendered.length, 0);
      assert.equal(context.historyRecord.revision, 1);
      assert.equal(draft.value, scenario === 'unsaved' ? 'unsaved text' : 'saved');
    }
  });
}
