import test from 'node:test';
import assert from 'node:assert/strict';
import { createDigestJobs } from '../src/digest-jobs.js';

const baseline = { sourceUrls: ['https://example.com/a'], themes: ['AI'], editorialPrompt: 'pilot only', from: '2026-01-01', to: '2026-01-31' };
const sid = 'submission_issue16_0123456789';
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('submission ID rejects changes to each semantic parameter and strips password', async () => {
  const jobs = createDigestJobs({ worker: async () => ({}) });
  const first = jobs.submit({ ...baseline, executionPassword: 'secret', submissionId: sid });
  for (const changed of [
    { sourceUrls: ['https://example.com/b'] },
    { themes: ['security'] },
    { editorialPrompt: 'different' },
    { from: '2026-01-02' },
    { to: '2026-01-30' }
  ]) {
    assert.throws(() => jobs.submit({ ...baseline, ...changed, submissionId: sid }), { code: 'submission_conflict' });
    assert.equal(jobs.status(first.jobId).jobId, first.jobId);
  }
  const same = jobs.submit({ ...baseline, executionPassword: 'other-password', submissionId: sid });
  assert.equal(same.jobId, first.jobId);
  await tick();
});

test('same-ID concurrent identical submissions invoke exactly one worker', async () => {
  let calls = 0;
  const jobs = createDigestJobs({ worker: async () => { calls += 1; return { ok: true }; } });
  const a = jobs.submit({ ...baseline, submissionId: sid });
  const b = jobs.submit({ ...baseline, submissionId: sid });
  assert.equal(a.jobId, b.jobId);
  await tick();
  assert.equal(calls, 1);
});
