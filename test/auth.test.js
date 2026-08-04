import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionAuth } from '../src/auth.js';

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('protects only an AI execution request with the configured password header', () => {
  const auth = createExecutionAuth('separate shared password');
  const denied = response();
  auth({ headers: {} }, denied, () => assert.fail('must not continue'));
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(denied.body, { error: 'Введите пароль для запуска AI-отбора.' });

  const allowed = response();
  let continued = false;
  auth({ headers: { 'x-ai-digest-password': 'separate shared password' } }, allowed, () => { continued = true; });
  assert.equal(continued, true);
});
