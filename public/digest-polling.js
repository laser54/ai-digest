const jsonRequest = (body, signal) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  signal
});

async function readResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || 'Network request failed');
    error.status = response.status;
    throw error;
  }
  return body;
}

export function createSubmissionId(crypto = globalThis.crypto) {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function startAndPollDigest(input, {
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutSignal = (ms) => AbortSignal.timeout(ms),
  onProgress = () => {},
  createSubmissionId: generateSubmissionId = createSubmissionId
} = {}) {
  const request = (url, body) => fetch(url, jsonRequest(body, timeoutSignal(15_000))).then(readResponse);
  const startInput = { ...input, submissionId: generateSubmissionId() };
  let started;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      started = await request('/api/digest/jobs', startInput);
      break;
    } catch (error) {
      if ((error.status && error.status < 500) || attempt === 2) {
        if (!error.status && attempt === 2) throw new Error('Network request failed');
        throw error;
      }
      await sleep(500 * (2 ** attempt));
    }
  }
  let failures = 0;
  while (true) {
    await sleep(Math.min(2000 * (2 ** Math.max(0, failures - 1)), 10_000));
    try {
      const status = await request('/api/digest/jobs/status', {
        jobId: started.jobId,
        executionPassword: input.executionPassword
      });
      failures = 0;
      if (status.progress) onProgress(status.progress);
      if (status.status === 'complete') return status.result;
      if (status.status === 'error') {
        const error = new Error(status.error?.message || 'Failed to prepare digest');
        error.terminal = true;
        throw error;
      }
    } catch (error) {
      if (error.terminal || (error.status && (error.status < 500 || error.status > 599))) throw error;
      failures += 1;
      if (failures >= 5) throw new Error('Network request failed');
    }
  }
}
