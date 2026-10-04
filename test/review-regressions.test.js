import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createDigestHistory } from '../src/digest-history.js';
import { isRetryEligibleOutcome, safeHttpUrl } from '../public/safe-links.js';
import { renderNextPageButton } from '../public/history-pagination.js';

async function withServer(app, run) {
  const server = app.listen(0); await new Promise((resolve) => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const authBody = (body = {}) => JSON.stringify({ ...body, executionPassword: 'secret' });

test('browser and server share fail-closed retry eligibility; reauthentication is never retryable', async () => {
  assert.equal(isRetryEligibleOutcome('unreachable_from_research'), true);
  for (const outcome of ['reauthentication_required', 'blocked', 'unsupported', 'no_relevant_articles', 'researched', 'timeout']) {
    assert.equal(isRetryEligibleOutcome(outcome), false, outcome);
  }
  const directory = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'digest-retry-policy-'));
  const history = createDigestHistory(directory);
  const url = 'https://example.com/reauth';
  const record = await history.create({ snapshot: { sourceUrls: [url] }, result: { articles: [], researchSources: [{ url, outcome: 'reauthentication_required' }] } });
  let calls = 0;
  const app = createApp({ password: 'secret', history, jobs: { submit() { calls += 1; return { jobId: 'job_abcdef' }; }, status() { return null; } } });
  try {
    await withServer(app, async (base) => {
      const unauthorized = await fetch(`${base}/api/digests/${record.id}/retries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: record.revision, submissionId: 'retry_reauth_0123456789012345', selectedSourceUrls: [url] }) });
      assert.equal(unauthorized.status, 401);
      const refused = await fetch(`${base}/api/digests/${record.id}/retries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: authBody({ revision: record.revision, submissionId: 'retry_reauth_0123456789012345', selectedSourceUrls: [url] }) });
      assert.equal(refused.status, 400);
      assert.equal(calls, 0);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('history rendering URL policy rejects script schemes and credentials while normalizing HTTP(S)', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeHttpUrl('https://user:pass@example.com/a'), null);
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeHttpUrl('http://example.com/a'), 'http://example.com/a');
});

test('actual history next-page renderer passes cursor to navigation and omits terminal button', () => {
  const listeners = {};
  const children = [];
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => ({ tagName, addEventListener(type, handler) { listeners[type] = handler; } }) };
  try {
    const container = { append(node) { children.push(node); } };
    const visited = [];
    const button = renderNextPageButton(container, 'dig_abcdefghijklmnop', (cursor) => visited.push(cursor));
    assert.equal(button.textContent, 'Следующие выпуски');
    listeners.click();
    assert.deepEqual(visited, ['dig_abcdefghijklmnop']);
    assert.equal(renderNextPageButton(container, null, () => assert.fail('no terminal page button expected')), null);
    assert.equal(children.length, 1);
  } finally { globalThis.document = originalDocument; }
});

test('history cursor walks durable records once in order and rejects invalid cursor explicitly', async () => {
  const directory = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'digest-pages-'));
  try {
    const history = createDigestHistory(directory);
    const records = [];
    for (let index = 0; index < 3; index += 1) {
      records.push(await history.create({ snapshot: { sourceUrls: [] }, result: { articles: [] }, name: `record-${index}` }));
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    const restarted = createDigestHistory(directory);
    const visited = [];
    let cursor;
    do {
      const page = await restarted.list({ limit: 1, ...(cursor ? { cursor } : {}) });
      visited.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(visited, records.slice().reverse().map((record) => record.id));
    assert.equal(new Set(visited).size, 3);
    await assert.rejects(restarted.list({ limit: 1, cursor: 'dig_nonexistent0000000000000000' }), { code: 'invalid_history_cursor' });
    const finalPage = await restarted.list({ limit: 1, cursor: visited.at(-1) });
    assert.deepEqual(finalPage.items, []);
    assert.equal(finalPage.nextCursor, null);
    const edited = await restarted.update(records[0].id, { selectedUrls: ['https://example.com/kept'] }, records[0].revision);
    const restored = await createDigestHistory(directory).get(records[0].id);
    assert.deepEqual(restored.selectedUrls, ['https://example.com/kept']);
    assert.equal(edited.revision, restored.revision);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('malformed history IDs are typed 400 and genuine history storage errors remain safe 500s', async () => {
  const app = createApp({ password: 'secret', history: { async get() { throw new Error('disk details must not leak'); } }, jobs: { submit() {}, status() { return null; } } });
  await withServer(app, async (base) => {
    const malformed = await fetch(`${base}/api/digests/not-an-id/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: authBody() });
    assert.equal(malformed.status, 400);
    const storageFailure = await fetch(`${base}/api/digests/dig_abcdefghijklmnop/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: authBody() });
    assert.equal(storageFailure.status, 500);
    assert.doesNotMatch(await storageFailure.text(), /disk details/);
  });
});
