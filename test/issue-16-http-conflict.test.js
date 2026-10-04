import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { createDigestJobs } from '../src/digest-jobs.js';

async function withServer(app, run) {
  const server = app.listen(0); await new Promise((resolve) => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const send = (base, body) => fetch(`${base}/api/digest/jobs`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

test('HTTP submission conflict is typed, authenticated first, and terminal same-ID reuse does not invoke worker twice', async () => {
  let calls = 0;
  const jobs = createDigestJobs({ worker: async () => { calls += 1; throw new Error('private failure'); } });
  const app = createApp({ password: 'secret', jobs });
  const submissionId = 'issue16_http_test_submission_012345';
  const baseBody = { sourceUrls: ['https://example.com'], themes: ['AI'], editorialPrompt: 'pilot', from: '2026-09-01', to: '2026-09-12', submissionId, executionPassword: 'secret' };
  await withServer(app, async (base) => {
    const firstResponse = await send(base, baseBody);
    assert.equal(firstResponse.status, 202);
    const first = await firstResponse.json();
    let state;
    for (let count = 0; count < 100; count += 1) {
      const response = await fetch(`${base}/api/digest/jobs/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: first.jobId, executionPassword: 'secret' }) });
      state = await response.json();
      if (state.status === 'error') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state.status, 'error');
    const unauthorized = await send(base, { ...baseBody, themes: ['security'], executionPassword: 'wrong' });
    assert.equal(unauthorized.status, 401);
    const changed = await send(base, { ...baseBody, themes: ['security'] });
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).code, 'submission_conflict');
    const reused = await send(base, baseBody);
    assert.equal(reused.status, 202);
    const repeated = await reused.json();
    assert.equal(repeated.jobId, first.jobId);
    assert.equal(repeated.status, 'error');
    assert.equal(repeated.reused, true);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(state).includes('secret'), false);
  });
});
