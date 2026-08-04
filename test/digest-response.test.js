import test from 'node:test';
import assert from 'node:assert/strict';
import { readDigestStream } from '../public/digest-response.js';

function streamResponse(lines) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      }
    })
  };
}

test('reads progress and final result from an NDJSON response', async () => {
  const progress = [];
  const result = await readDigestStream(streamResponse([
    '{"type":"progress","phase":"prefetching","sourceCount":2}\n',
    '{"type":"result","articles":[],"automaticDigestUrls":[],"progress":[]}\n'
  ]), (event) => progress.push(event));

  assert.deepEqual(progress, [{ type: 'progress', phase: 'prefetching', sourceCount: 2 }]);
  assert.deepEqual(result.articles, []);
});

test('releases the response reader when an NDJSON event is malformed', async () => {
  let released = false;
  const reader = {
    async read() { return { done: false, value: new TextEncoder().encode('{not json}\n') }; },
    releaseLock() { released = true; }
  };
  await assert.rejects(() => readDigestStream({ ok: true, body: { getReader: () => reader } }, () => {}));
  assert.equal(released, true);
});
