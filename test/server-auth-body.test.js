import test from 'node:test';
import assert from 'node:assert/strict';

// Pull the schema indirectly by parsing the same shape the server uses.
// We import server.js for its side-effect (it does not start a listener under
// test mode), then call into the schema indirectly through a known endpoint
// that requires the parsed body.
//
// In practice this test is a contract assertion: the /api/digest/prepare
// endpoint must NOT propagate executionPassword to the parsed input that
// downstream code (audit logger, discovery) sees.

import { app } from '../src/server.js';

async function readBody(response) {
  return response.text();
}

test('request schema does not propagate executionPassword to the parsed input', async () => {
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_PASSWORD = 'ascii-secret';

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const body = JSON.stringify({
      sourceUrls: ['https://example.com/news'],
      themes: [],
      from: '',
      to: '',
      executionPassword: 'ascii-secret'
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/digest/prepare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    });
    const text = await readBody(response);
    // The server passes through to discoverDigest; with no working Codex in the
    // test environment, we expect a stream with progress events followed by an
    // error event. Either way, the parsed input must not leak the password
    // into the wire response.
    assert.equal(text.includes('ascii-secret'), false, 'executionPassword must not be echoed in any wire response');
    assert.equal(text.includes('executionPassword'), false, 'executionPassword key must not appear in any wire response');
  } finally {
    server.close();
    delete process.env.ADMIN_PASSWORD;
  }
});
