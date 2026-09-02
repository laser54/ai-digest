import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmissionId, startAndPollDigest } from '../public/digest-polling.js';

const response = (body, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body });

test('submission id generation uses randomUUID with getRandomValues fallback', () => {
  assert.equal(createSubmissionId({ randomUUID: () => 'uuid-value' }), 'uuid-value');
  assert.equal(createSubmissionId({ getRandomValues: (bytes) => bytes.fill(0xab) }), 'ab'.repeat(16));
});

test('starts then polls without overlap, reports progress, and returns completion', async () => {
  const calls = [];
  const signals = [];
  let inFlight = 0;
  const progress = [];
  const fetch = async (url, options) => {
    assert.equal(inFlight, 0);
    inFlight += 1;
    calls.push([url, JSON.parse(options.body)]);
    signals.push(options.signal);
    const reply = calls.length === 1
      ? response({ jobId: 'job_opaque', status: 'queued' }, true)
      : calls.length === 2
        ? response({ jobId: 'job_opaque', status: 'running', progress: { phase: 'researching' } })
        : response({ jobId: 'job_opaque', status: 'complete', result: { articles: [] } });
    inFlight -= 1;
    return reply;
  };
  const result = await startAndPollDigest({ sourceUrls: ['https://example.com'], editorialPrompt: 'Только пилоты', executionPassword: 'пароль' }, {
    fetch,
    sleep: async () => {},
    timeoutSignal: (ms) => ({ timeout: ms }),
    createSubmissionId: () => 'submission_browser_generated',
    onProgress: (event) => progress.push(event)
  });
  assert.deepEqual(result, { articles: [] });
  assert.deepEqual(progress, [{ phase: 'researching' }]);
  assert.deepEqual(calls.map(([url]) => url), ['/api/digest/jobs', '/api/digest/jobs/status', '/api/digest/jobs/status']);
  assert.equal(calls[0][1].submissionId, 'submission_browser_generated');
  assert.equal(calls[0][1].editorialPrompt, 'Только пилоты');
  assert.deepEqual(calls[1][1], { jobId: 'job_opaque', executionPassword: 'пароль' });
  assert.deepEqual(signals, [{ timeout: 15_000 }, { timeout: 15_000 }, { timeout: 15_000 }]);
});

test('retries transient start failures with bounded backoff', async () => {
  const delays = [];
  const startBodies = [];
  let call = 0;
  const result = await startAndPollDigest({ executionPassword: 'x' }, {
    fetch: async (url, options) => {
      call += 1;
      if (url.endsWith('/jobs')) startBodies.push(JSON.parse(options.body));
      if (url.endsWith('/jobs') && call === 1) throw new TypeError('response lost');
      if (url.endsWith('/jobs') && call === 2) return response({ error: 'temporary' }, false, 503);
      if (url.endsWith('/jobs')) return response({ jobId: 'job_same', status: 'running', reused: true });
      return response({ jobId: 'job_same', status: 'complete', result: { articles: [] } });
    },
    sleep: async (ms) => delays.push(ms),
    createSubmissionId: () => 'submission_retry_same'
  });
  assert.deepEqual(result, { articles: [] });
  assert.equal(call, 4);
  assert.deepEqual(delays, [500, 1000, 2000]);
  assert.deepEqual(startBodies.map(({ submissionId }) => submissionId), ['submission_retry_same', 'submission_retry_same', 'submission_retry_same']);
});

test('fails start immediately for auth and validation responses', async () => {
  for (const status of [400, 401, 403, 422]) {
    let calls = 0;
    const delays = [];
    await assert.rejects(() => startAndPollDigest({ executionPassword: 'bad' }, {
      fetch: async () => { calls += 1; return response({ error: 'rejected' }, false, status); },
      sleep: async (ms) => delays.push(ms)
    }), /rejected/);
    assert.equal(calls, 1);
    assert.deepEqual(delays, []);
  }
});

test('bounds transient start retries', async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(() => startAndPollDigest({ executionPassword: 'x' }, {
    fetch: async () => { calls += 1; throw new TypeError('offline'); },
    sleep: async (ms) => delays.push(ms)
  }), /Network request failed/);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test('recovers from transient polling failures with bounded backoff', async () => {
  const delays = [];
  let call = 0;
  const fetch = async () => {
    call += 1;
    if (call === 1) return response({ jobId: 'job_1', status: 'queued' });
    if (call === 2) throw new TypeError('mobile network error');
    if (call === 3) return response({ error: 'temporary' }, false);
    return response({ jobId: 'job_1', status: 'complete', result: { articles: ['done'] } });
  };
  const result = await startAndPollDigest({ executionPassword: 'x' }, { fetch, sleep: async (ms) => delays.push(ms) });
  assert.deepEqual(result.articles, ['done']);
  assert.deepEqual(delays, [2000, 2000, 4000]);
});

test('fails polling immediately for non-transient HTTP errors', async () => {
  for (const status of [401, 403, 404]) {
    let calls = 0;
    const delays = [];
    await assert.rejects(() => startAndPollDigest({ executionPassword: 'bad' }, {
      fetch: async () => ++calls === 1
        ? response({ jobId: 'job_1', status: 'queued' })
        : response({ error: `status rejected ${status}` }, false, status),
      sleep: async (ms) => delays.push(ms)
    }), Object.assign(new Error(`status rejected ${status}`), { status }));
    assert.equal(calls, 2);
    assert.deepEqual(delays, [2000]);
  }
});

test('surfaces terminal safe job error', async () => {
  let call = 0;
  await assert.rejects(() => startAndPollDigest({ executionPassword: 'x' }, {
    fetch: async () => ++call === 1 ? response({ jobId: 'job_1', status: 'queued' }) : response({ jobId: 'job_1', status: 'error', error: { message: 'Failed to prepare digest' } }),
    sleep: async () => {}
  }), /Failed to prepare digest/);
});
