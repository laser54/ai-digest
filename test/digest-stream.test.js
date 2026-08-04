import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDigestStreamEvent } from '../src/digest-stream.js';

test('encodes progress and final digest responses as newline-delimited JSON events', () => {
  assert.equal(
    encodeDigestStreamEvent('progress', { phase: 'prefetching', sourceCount: 2 }),
    '{"type":"progress","phase":"prefetching","sourceCount":2}\n'
  );
  assert.equal(
    encodeDigestStreamEvent('result', { articles: [], automaticDigestUrls: [], progress: [] }),
    '{"type":"result","articles":[],"automaticDigestUrls":[],"progress":[]}\n'
  );
});
