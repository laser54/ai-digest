import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createDigestHistory } from '../src/digest-history.js';
import { createDigestJobs } from '../src/digest-jobs.js';
import { formatDigestForClipboard } from '../public/digest-clipboard.js';

const delay = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function withServer(app, run) {
  const server = app.listen(0); await new Promise((resolve) => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('job history persists queued/running state, completes, restores selection after restart, and exports without research', async () => {
  const directory = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'digest-history-job-'));
  const history = createDigestHistory(directory);
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let workerCalls = 0;
  const jobs = createDigestJobs({ worker: async () => {
    workerCalls += 1;
    await hold;
    return { articles: [{ url: 'https://example.com/a', title: 'Saved article' }], automaticDigestUrls: [], sources: [], researchSources: [], tokenUsage: { available: false } };
  } });
  const app = createApp({ password: 'test-password', jobs, history });
  try {
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/digest/jobs`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceUrls: ['https://example.com'], themes: ['AI'], editorialPrompt: 'pilot', from: '2026-09-01', to: '2026-09-12', submissionId: 'history_job_flow_submission_01', executionPassword: 'test-password' })
      });
      assert.equal(response.status, 202);
      const started = await response.json();
      assert.ok(started.historyId);
      for (let count = 0; count < 300 && workerCalls === 0; count += 1) await delay(10);
      const running = await history.get(started.historyId);
      assert.equal(running.status, 'running');
      assert.deepEqual(running.snapshot, { sourceUrls: ['https://example.com/'], themes: ['AI'], editorialPrompt: 'pilot', from: '2026-09-01', to: '2026-09-12' });
      assert.equal(JSON.stringify(running).includes('test-password'), false);
      const afterRestart = await createDigestHistory(directory).get(started.historyId);
      assert.equal(afterRestart.status, 'interrupted');
      release();
      let status;
      let completed;
      for (let count = 0; count < 400; count += 1) {
        status = jobs.status(started.jobId);
        completed = await history.get(started.historyId);
        if (status.status === 'complete' && completed.status === 'complete') break;
        await delay(20);
      }
      assert.equal(status.status, 'complete');
      assert.equal(workerCalls, 1);
      assert.equal(completed.status, 'complete');
      const selected = await history.update(completed.id, { selectedUrls: ['https://example.com/a'], editorialDraft: 'Editorial copy' }, completed.revision);
      const restored = await createDigestHistory(directory).get(completed.id);
      assert.deepEqual(restored.selectedUrls, ['https://example.com/a']);
      assert.equal(restored.editorialDraft, 'Editorial copy');
      assert.equal(formatDigestForClipboard(restored.result.articles.filter((article) => restored.selectedUrls.includes(article.url))), '1. Saved article\nhttps://example.com/a');
      assert.equal((await history.list()).items[0].status, 'complete');
      assert.equal(selected.status, 'complete');
    });
  } finally { release(); await rm(directory, { recursive: true, force: true }); }
});
