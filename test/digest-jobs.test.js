import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigestJobs } from '../src/digest-jobs.js';

const input = (url = 'https://example.com/news') => ({ sourceUrls: [url], themes: [], from: '', to: '' });
let submission = 0;
const submit = (jobs, value = input(), submissionId = `submission_${++submission}`) => jobs.submit({ ...value, submissionId });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('job lifecycle exposes safe progress and final result', async () => {
  const gate = deferred();
  const jobs = createDigestJobs({ worker: async (_input, progress) => {
    progress({ phase: 'researching', sourceCount: 1 });
    await gate.promise;
    return { articles: [], automaticDigestUrls: [], progress: [], sources: [], researchSources: [], tokenUsage: { available: false }, requestId: 'req_1' };
  }});
  const submitted = submit(jobs);
  assert.equal(submitted.status, 'queued');
  await tick();
  assert.deepEqual(jobs.status(submitted.jobId), { jobId: submitted.jobId, status: 'running', progress: { phase: 'researching', sourceCount: 1 } });
  gate.resolve();
  await tick();
  assert.equal(jobs.status(submitted.jobId).status, 'complete');
  assert.deepEqual(jobs.status(submitted.jobId).result.articles, []);
});

test('identical active input is deduplicated without storing password', async () => {
  const gate = deferred();
  let calls = 0;
  const jobs = createDigestJobs({ worker: async (workerInput) => {
    calls += 1;
    assert.equal('executionPassword' in workerInput, false);
    await gate.promise;
    return { ok: true };
  } });
  const first = submit(jobs);
  const second = submit(jobs, { ...input(), executionPassword: 'пароль🔐' });
  assert.equal(second.jobId, first.jobId);
  assert.equal(second.reused, true);
  assert.equal(JSON.stringify(jobs).includes('пароль🔐'), false);
  await tick();
  assert.equal(calls, 1);
  gate.resolve();
});

test('lost start response retry reuses a fast completed job', async () => {
  let calls = 0;
  const jobs = createDigestJobs({ worker: async () => ({ call: ++calls }) });
  const submissionId = 'submission_lost_response';
  const first = submit(jobs, input(), submissionId);
  await tick();
  const retry = submit(jobs, { ...input(), executionPassword: 'never-store-me' }, submissionId);
  assert.deepEqual(retry, { jobId: first.jobId, status: 'complete', reused: true });
  assert.deepEqual(jobs.status(retry.jobId), { jobId: first.jobId, status: 'complete', result: { call: 1 } });
  assert.equal(calls, 1);
});

test('new submission id after completion starts fresh identical work', async () => {
  let calls = 0;
  const jobs = createDigestJobs({ worker: async () => ({ call: ++calls }) });
  const first = submit(jobs);
  await tick();
  const second = submit(jobs);
  assert.notEqual(second.jobId, first.jobId);
  assert.equal(second.reused, false);
  await tick();
  assert.deepEqual(jobs.status(second.jobId).result, { call: 2 });
});

test('TTL removal deletes submission id mappings', async () => {
  let now = 0;
  let calls = 0;
  const jobs = createDigestJobs({ worker: async () => ({ call: ++calls }), clock: () => now, ttlMs: 10 });
  const submissionId = 'submission_expires';
  const first = submit(jobs, input(), submissionId);
  await tick();
  now = 10;
  const second = submit(jobs, input(), submissionId);
  assert.notEqual(second.jobId, first.jobId);
  assert.equal(second.reused, false);
  await tick();
  assert.deepEqual(jobs.status(second.jobId).result, { call: 2 });
});

test('audits lifecycle and reuse without logging password or flooding status polls', async () => {
  const gate = deferred();
  const events = [];
  const loggerFactory = () => ({
    requestId: 'req_test',
    info(event, data) { events.push({ event, data }); },
    error(event, data) { events.push({ event, data }); }
  });
  const jobs = createDigestJobs({ worker: async () => { await gate.promise; return { ok: true }; }, loggerFactory });
  const job = submit(jobs, { ...input(), executionPassword: 'never-log-me' }, 'submission_never_log_1');
  submit(jobs, { ...input(), executionPassword: 'never-log-me' }, 'submission_never_log_2');
  await tick();
  jobs.status(job.jobId);
  jobs.status(job.jobId);
  assert.deepEqual(events.map(({ event }) => event), ['digest.job.submitted', 'digest.job.reused', 'digest.job.started']);
  assert.equal(JSON.stringify(events).includes('never-log-me'), false);
  assert.equal(JSON.stringify(events).includes('submission_never_log'), false);
  gate.resolve();
  await tick();
  assert.equal(events.at(-1).event, 'digest.job.completed');
});

test('global concurrency is one and queued jobs start FIFO', async () => {
  const gates = [deferred(), deferred(), deferred()];
  const started = [];
  const jobs = createDigestJobs({ worker: async (value) => {
    const index = Number(new URL(value.sourceUrls[0]).pathname.slice(1));
    started.push(index);
    await gates[index].promise;
    return { index };
  }});
  const submitted = [0, 1, 2].map((index) => submit(jobs, input(`https://example.com/${index}`)));
  await tick();
  assert.deepEqual(started, [0]);
  assert.equal(jobs.status(submitted[1].jobId).status, 'queued');
  gates[0].resolve(); await tick();
  assert.deepEqual(started, [0, 1]);
  gates[1].resolve(); await tick();
  assert.deepEqual(started, [0, 1, 2]);
  gates[2].resolve();
});

test('status preserves a completed result at capacity until TTL expiry', async () => {
  let now = 0;
  const jobs = createDigestJobs({
    worker: async () => ({ ok: true }),
    clock: () => now,
    ttlMs: 10,
    maxJobs: 1
  });
  const job = submit(jobs);
  await tick();
  assert.deepEqual(jobs.status(job.jobId).result, { ok: true });
  now = 9;
  assert.deepEqual(jobs.status(job.jobId).result, { ok: true });
  now = 10;
  assert.equal(jobs.status(job.jobId), null);
});

test('TTL removes expired jobs but capacity never evicts unexpired terminal results', async () => {
  let now = 0;
  const active = deferred();
  const jobs = createDigestJobs({
    worker: async (value) => value.sourceUrls[0].endsWith('/active') ? active.promise : { ok: true },
    clock: () => now,
    ttlMs: 10,
    maxJobs: 2
  });
  const old = submit(jobs, input('https://example.com/old'));
  await tick();
  now = 11;
  const running = submit(jobs, input('https://example.com/active'));
  await tick();
  submit(jobs, input('https://example.com/queued'));
  assert.equal(jobs.status(old.jobId), null);
  assert.equal(jobs.status(running.jobId).status, 'running');
  assert.throws(() => submit(jobs, input('https://example.com/full')), /busy/i);
  active.resolve({ ok: true });
});

test('at capacity keeps terminal result retrievable and rejects new work as busy', async () => {
  const jobs = createDigestJobs({ worker: async () => ({ retained: true }), maxJobs: 1 });
  const retained = submit(jobs);
  await tick();
  assert.throws(() => submit(jobs, input('https://example.com/new')), /busy/i);
  assert.deepEqual(jobs.status(retained.jobId).result, { retained: true });
});

test('worker failures expose only a safe error', async () => {
  const jobs = createDigestJobs({ worker: async () => { throw new Error('secret prompt and password'); } });
  const job = submit(jobs);
  await tick();
  assert.deepEqual(jobs.status(job.jobId).error, { message: 'Failed to prepare digest' });
  assert.equal(JSON.stringify(jobs.status(job.jobId)).includes('secret'), false);
});
