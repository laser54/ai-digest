import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createDigestHistory } from '../src/digest-history.js';
import { createDigestJobs } from '../src/digest-jobs.js';

const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function withServer(app, run) {
  const server = app.listen(0); await new Promise((resolve) => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('durable retry runs only selected failed sources and merges without overwriting edits or double-counting usage', async () => {
  const directory = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'digest-retry-'));
  const history = createDigestHistory(directory);
  const failed = 'https://example.com/failed';
  const healthy = 'https://example.com/healthy';
  const duplicate = 'https://example.com/article';
  const selectedAfterEdit = 'https://example.com/editor-picked';
  const originalUsage = { available: true, inputTokens: 10 };
  const parent = await history.create({
    snapshot: { sourceUrls: [failed, healthy], themes: ['AI'], editorialPrompt: 'Keep pilots', from: '2026-09-01', to: '2026-09-12' },
    result: {
      articles: [{ url: duplicate, title: 'Original title' }], automaticDigestUrls: [duplicate],
      researchSources: [{ url: failed, outcome: 'unreachable_from_research', foundCount: 0 }, { url: healthy, outcome: 'researched', foundCount: 1 }],
      tokenUsage: originalUsage
    },
    selectedUrls: [duplicate]
  });
  const blocked = gate();
  const calls = [];
  const jobs = createDigestJobs({ worker: async (input) => {
    calls.push(input);
    await blocked.promise;
    return {
      articles: [{ url: `${duplicate}#new`, title: 'Should not replace editor version' }, { url: 'https://example.com/new', title: 'New article' }],
      automaticDigestUrls: ['https://example.com/new'],
      researchSources: [{ url: failed, outcome: 'researched', foundCount: 2 }],
      tokenUsage: { available: true, inputTokens: 7 }
    };
  } });
  const app = createApp({ password: 'secret', history, jobs });
  const submissionId = 'retry_issue19_same_submission_id';
  try {
    await withServer(app, async (base) => {
      const retry = await fetch(`${base}/api/digests/${parent.id}/retries`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: parent.revision, submissionId, selectedSourceUrls: [failed], executionPassword: 'secret' })
      });
      assert.equal(retry.status, 202);
      const started = await retry.json();
      for (let count = 0; count < 400 && calls.length === 0; count += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].sourceUrls, [failed]);
      assert.deepEqual(calls[0].themes, parent.snapshot.themes);
      assert.equal(calls[0].from, parent.snapshot.from);
      assert.equal(calls[0].to, parent.snapshot.to);
      assert.equal(calls[0].editorialPrompt, parent.snapshot.editorialPrompt);
      assert.equal((await history.get(parent.id)).snapshot.sourceUrls.length, 2);
      const latest = await history.get(parent.id);
      await history.update(parent.id, { selectedUrls: [selectedAfterEdit], editorialDraft: 'Concurrent hand edit' }, latest.revision);
      blocked.resolve();
      let completed;
      for (let count = 0; count < 400; count += 1) {
        completed = await history.get(parent.id);
        if (completed.attempts[0]?.status === 'complete') break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(completed.attempts[0].status, 'complete');
      assert.deepEqual(completed.selectedUrls, [selectedAfterEdit]);
      assert.equal(completed.editorialDraft, 'Concurrent hand edit');
      assert.equal(completed.result.articles.length, 2);
      assert.equal(completed.result.articles.find((item) => item.url === duplicate).title, 'Original title');
      assert.equal(completed.result.tokenUsage.inputTokens, originalUsage.inputTokens);
      assert.equal(completed.attempts[0].usage.inputTokens, 7);
      const replay = await fetch(`${base}/api/digests/${parent.id}/retries`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: completed.revision, submissionId, selectedSourceUrls: [failed], executionPassword: 'secret' })
      });
      assert.equal(replay.status, 202);
      assert.equal((await replay.json()).reused, true);
      assert.equal(calls.length, 1);
      const invalid = await fetch(`${base}/api/digests/${parent.id}/retries`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: completed.revision, submissionId: 'retry_issue19_another_unique_id', selectedSourceUrls: [healthy], executionPassword: 'secret' })
      });
      assert.equal(invalid.status, 400);
      assert.equal(started.attemptId, completed.attempts[0].id);
    });
  } finally {
    blocked.resolve();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed retry records its attempt while preserving the prior useful result', async () => {
  const directory = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'digest-retry-failure-'));
  const history = createDigestHistory(directory);
  const failed = 'https://example.com/failed-again';
  const original = { articles: [{ url: 'https://example.com/kept', title: 'Keep me' }], automaticDigestUrls: [], researchSources: [{ url: failed, outcome: 'unreachable_from_research', foundCount: 0 }], tokenUsage: { available: true, inputTokens: 5 } };
  const parent = await history.create({ snapshot: { sourceUrls: [failed], themes: ['AI'], editorialPrompt: 'pilot', from: '2026-09-01', to: '2026-09-12' }, result: original, selectedUrls: ['https://example.com/kept'] });
  const jobs = createDigestJobs({ worker: async () => { throw new Error('simulated timeout'); } });
  try {
    const app = createApp({ password: 'secret', history, jobs });
    await withServer(app, async (base) => {
      const unauthorized = await fetch(`${base}/api/digests/${parent.id}/retries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: parent.revision, submissionId: 'retry_issue19_failure_0123456789', selectedSourceUrls: [failed] }) });
      assert.equal(unauthorized.status, 401);
      const response = await fetch(`${base}/api/digests/${parent.id}/retries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: parent.revision, submissionId: 'retry_issue19_failure_0123456789', selectedSourceUrls: [failed], executionPassword: 'secret' }) });
      assert.equal(response.status, 202);
      let after;
      for (let count = 0; count < 400; count += 1) {
        after = await history.get(parent.id);
        if (after.attempts[0]?.status === 'error') break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(after.attempts[0].status, 'error');
      assert.deepEqual(after.result, original);
      assert.deepEqual(after.selectedUrls, ['https://example.com/kept']);
      assert.equal(after.attempts[0].usage.available, false);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
