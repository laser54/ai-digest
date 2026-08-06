import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRequestId,
  sanitizeUrl,
  sanitizeLogObject,
  AuditLogger
} from '../src/logging.js';

test('generateRequestId produces a unique string prefix', () => {
  const id1 = generateRequestId();
  const id2 = generateRequestId();
  assert.ok(id1.startsWith('req_'));
  assert.ok(id2.startsWith('req_'));
  assert.notEqual(id1, id2);
});

test('sanitizeUrl removes credentials and query params', () => {
  assert.equal(
    sanitizeUrl('https://admin:secret123@example.com/news?token=abc#section'),
    'https://example.com/news'
  );
  assert.equal(
    sanitizeUrl('http://127.0.0.1:8080/admin/path?key=val'),
    'http://127.0.0.1:8080/admin/path'
  );
  assert.equal(sanitizeUrl('not a url'), 'invalid-url');
});

test('sanitizeLogObject redacts sensitive keys and values', () => {
  const raw = {
    password: 'super-secret-pass',
    ADMIN_PASSWORD: 'admin-secret-pass',
    authorization: 'Bearer secret-token',
    cookie: 'session=12345',
    html: '<html><body>Secret page</body></html>',
    prompt: 'System prompt with private info',
    body: 'ArrayBuffer of 1.5MB html',
    sourceUrl: 'https://user:pass@example.com/news?key=123',
    safeField: 'normal-value',
    nested: {
      secretKey: 'top-secret',
      count: 42
    }
  };

  const sanitized = sanitizeLogObject(raw);

  assert.equal(sanitized.password, '[REDACTED]');
  assert.equal(sanitized.ADMIN_PASSWORD, '[REDACTED]');
  assert.equal(sanitized.authorization, '[REDACTED]');
  assert.equal(sanitized.cookie, '[REDACTED]');
  assert.equal(sanitized.html, '[REDACTED]');
  assert.equal(sanitized.prompt, '[REDACTED]');
  assert.equal(sanitized.body, '[REDACTED]');
  assert.equal(sanitized.sourceUrl, 'https://example.com/news');
  assert.equal(sanitized.safeField, 'normal-value');
  assert.equal(sanitized.nested.secretKey, '[REDACTED]');
  assert.equal(sanitized.nested.count, 42);

  const jsonString = JSON.stringify(sanitized);
  assert.equal(jsonString.includes('super-secret-pass'), false);
  assert.equal(jsonString.includes('admin-secret-pass'), false);
  assert.equal(jsonString.includes('secret-token'), false);
  assert.equal(jsonString.includes('<html>'), false);
});

test('AuditLogger captures structured audit events with correlation ID', () => {
  const emittedLogs = [];
  const logger = new AuditLogger({
    writer: (logLine) => emittedLogs.push(JSON.parse(logLine)),
    requestId: 'req_test123'
  });

  logger.info('digest.request.started', { sourceCount: 2, themesCount: 1 });
  logger.info('digest.prefetch.source.completed', {
    sourceUrl: 'https://user:secret@example.com/news?token=xyz',
    status: 'fetched',
    durationMs: 120,
    candidateCount: 5,
    password: 'should-be-redacted'
  });

  assert.equal(emittedLogs.length, 2);

  assert.equal(emittedLogs[0].event, 'digest.request.started');
  assert.equal(emittedLogs[0].requestId, 'req_test123');
  assert.equal(emittedLogs[0].sourceCount, 2);

  assert.equal(emittedLogs[1].event, 'digest.prefetch.source.completed');
  assert.equal(emittedLogs[1].requestId, 'req_test123');
  assert.equal(emittedLogs[1].sourceUrl, 'https://example.com/news');
  assert.equal(emittedLogs[1].password, '[REDACTED]');
  assert.equal(emittedLogs[1].candidateCount, 5);
});
