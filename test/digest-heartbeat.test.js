import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startDigestHeartbeat } from '../src/server.js';
import { readDigestStream } from '../public/digest-response.js';

function response() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.chunks = [];
  res.write = (chunk) => res.chunks.push(chunk);
  return res;
}

function scheduler() {
  const timer = { unrefCalled: false, unref() { this.unrefCalled = true; } };
  return {
    timer,
    setInterval(callback, interval) {
      this.callback = callback;
      this.interval = interval;
      return timer;
    },
    clearInterval(value) { this.cleared = value; }
  };
}

test('writes an unrefed valid NDJSON heartbeat every 15 seconds without claiming progress', () => {
  const res = response();
  const clock = scheduler();
  startDigestHeartbeat(res, clock);

  assert.equal(clock.interval, 15_000);
  assert.equal(clock.timer.unrefCalled, true);
  clock.callback();
  assert.deepEqual(JSON.parse(res.chunks[0]), { type: 'heartbeat' });
  assert.equal(res.chunks[0].endsWith('\n'), true);
});

test('heartbeat cleanup is idempotent and stops writes after close or an ended response', () => {
  const res = response();
  const clock = scheduler();
  const stop = startDigestHeartbeat(res, clock);

  res.writableEnded = true;
  clock.callback();
  assert.deepEqual(res.chunks, []);
  res.emit('close');
  stop();
  assert.equal(clock.cleared, clock.timer);
});

test('current stream client safely ignores heartbeat events', async () => {
  const encoder = new TextEncoder();
  const response = {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"heartbeat"}\n'));
        controller.enqueue(encoder.encode('{"type":"result","articles":[],"automaticDigestUrls":[],"progress":[]}\n'));
        controller.close();
      }
    })
  };
  let progressCalls = 0;
  const result = await readDigestStream(response, () => { progressCalls += 1; });
  assert.equal(progressCalls, 0);
  assert.deepEqual(result.progress, []);
});
