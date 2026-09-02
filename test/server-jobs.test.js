import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('authenticated start and status endpoints keep password only in JSON auth body', async () => {
  let submitted;
  const jobs = {
    submit(input) { submitted = input; return { jobId: 'job_opaque', status: 'queued', reused: false }; },
    status(id) { return id === 'job_opaque' ? { jobId: id, status: 'running', progress: { phase: 'researching' } } : null; }
  };
  await withServer(createApp({ password: 'пароль🔐', jobs }), async (base) => {
    const start = await fetch(`${base}/api/digest/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      sourceUrls: ['https://example.com/news'], themes: [], editorialPrompt: '  Только внедрения  ', from: '', to: '', submissionId: 'submission_0123456789abcdef', executionPassword: 'пароль🔐'
    }) });
    assert.equal(start.status, 202);
    assert.deepEqual(await start.json(), { jobId: 'job_opaque', status: 'queued', reused: false });
    assert.equal('executionPassword' in submitted, false);
    assert.equal(submitted.submissionId, 'submission_0123456789abcdef');
    assert.equal(submitted.editorialPrompt, 'Только внедрения');

    const status = await fetch(`${base}/api/digest/jobs/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job_opaque', executionPassword: 'пароль🔐' }) });
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.status, 'running');
    assert.equal(JSON.stringify(body).includes('пароль🔐'), false);
  });
});

test('start validates submission id and store strips it before worker input', async () => {
  let workerInput;
  const { createDigestJobs } = await import('../src/digest-jobs.js');
  const jobs = createDigestJobs({ worker: async (input) => { workerInput = input; return { ok: true }; } });
  await withServer(createApp({ password: 'secret', jobs }), async (base) => {
    const start = (submissionId) => fetch(`${base}/api/digest/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      sourceUrls: ['https://example.com/news'], submissionId, executionPassword: 'secret'
    }) });
    assert.equal((await start('bad id')).status, 400);
    assert.equal((await start('submission_0123456789abcdef')).status, 202);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal('submissionId' in workerInput, false);
    assert.equal('executionPassword' in workerInput, false);
  });
});

test('job endpoints reject bad auth and unknown or malformed job ids safely', async () => {
  const jobs = { submit() { throw new Error('must not run'); }, status() { return null; } };
  await withServer(createApp({ password: 'secret', jobs }), async (base) => {
    const unauthorized = await fetch(`${base}/api/digest/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceUrls: ['https://example.com'], executionPassword: 'wrong' }) });
    assert.equal(unauthorized.status, 401);
    const missing = await fetch(`${base}/api/digest/jobs/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job_missing', executionPassword: 'secret' }) });
    assert.equal(missing.status, 404);
    const malformed = await fetch(`${base}/api/digest/jobs/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: '../../../etc/passwd', executionPassword: 'secret' }) });
    assert.equal(malformed.status, 400);
  });
});
