import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionAuth } from '../src/auth.js';

const originalEnv = process.env;
const originalNodeEnv = process.env.NODE_ENV;
const originalAdminPassword = process.env.ADMIN_PASSWORD;

function withAdminPassword(value, fn) {
  if (value === undefined) {
    delete process.env.ADMIN_PASSWORD;
  } else {
    process.env.ADMIN_PASSWORD = value;
  }
  return fn();
}

function makeReq(headers, body) {
  return { headers, body };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('createExecutionAuth accepts a Cyrillic password from the request body', () => {
  withAdminPassword('СуперСекретПароль123', () => {
    const middleware = createExecutionAuth(process.env.ADMIN_PASSWORD);
    const req = makeReq({}, { executionPassword: 'СуперСекретПароль123' });
    const res = makeRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, 'middleware must call next() when body password matches');
    assert.equal(res.statusCode, 200);
  });
});

test('createExecutionAuth accepts an emoji-bearing password from the request body', () => {
  withAdminPassword('пароль🔐тест', () => {
    const middleware = createExecutionAuth(process.env.ADMIN_PASSWORD);
    const req = makeReq({}, { executionPassword: 'пароль🔐тест' });
    const res = makeRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});

test('createExecutionAuth rejects a wrong password from the body', () => {
  withAdminPassword('СуперСекретПароль123', () => {
    const middleware = createExecutionAuth(process.env.ADMIN_PASSWORD);
    const req = makeReq({}, { executionPassword: 'другойПароль' });
    const res = makeRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /парол/i);
  });
});

test('createExecutionAuth rejects a missing body password', () => {
  withAdminPassword('СуперСекретПароль123', () => {
    const middleware = createExecutionAuth(process.env.ADMIN_PASSWORD);
    const req = makeReq({}, {});
    const res = makeRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

test('createExecutionAuth still accepts the header form for legacy clients (ASCII only)', () => {
  withAdminPassword('ascii-secret', () => {
    const middleware = createExecutionAuth(process.env.ADMIN_PASSWORD);
    const req = makeReq({ 'x-ai-digest-password': 'ascii-secret' }, {});
    const res = makeRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, 'header path must still work for ASCII-only passwords');
  });
});

test('createExecutionAuth rejects mismatched body vs header (defense in depth)', () => {
  withAdminPassword('ascii-secret', () => {
    const middleware = createExecutionAuth(process.env.ADMIN_PASSWORD);
    const req = makeReq({ 'x-ai-digest-password': 'wrong' }, { executionPassword: 'also-wrong' });
    const res = makeRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});
