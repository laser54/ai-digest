import test from 'node:test';
import assert from 'node:assert/strict';
import { createBasicAuth } from '../src/auth.js';

function response() {
  return {
    statusCode: 0,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    end() { this.ended = true; }
  };
}

test('requires the configured password for every browser/API request', () => {
  const auth = createBasicAuth('correct horse battery staple');
  const denied = response();
  auth({ headers: {} }, denied, () => assert.fail('must not continue'));
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.headers['WWW-Authenticate'], 'Basic realm="AI Digest"');

  const allowed = response();
  let continued = false;
  auth({ headers: { authorization: `Basic ${Buffer.from('sergey:correct horse battery staple').toString('base64')}` } }, allowed, () => { continued = true; });
  assert.equal(continued, true);
});
