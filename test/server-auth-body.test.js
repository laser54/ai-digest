import test from 'node:test';
import assert from 'node:assert/strict';
import { requestSchema, settingsSchema } from '../src/server.js';

// Pure unit assertion: the Zod schema does not declare `executionPassword`,
// so `.parse(body)` strips it. The downstream audit logger and discovery
// pipeline only ever see the parsed `input`, never the raw body, so the
// password can never reach them.
test('requestSchema strips executionPassword from the parsed input', () => {
  const raw = {
    sourceUrls: ['https://example.com/news'],
    themes: [],
    from: '',
    to: '',
    executionPassword: 'ascii-secret'
  };
  const parsed = requestSchema.parse(raw);
  assert.equal('executionPassword' in parsed, false, 'executionPassword key must not be in parsed input');
  assert.equal(Object.keys(parsed).includes('executionPassword'), false);
});

test('requestSchema succeeds without an executionPassword field', () => {
  const parsed = requestSchema.parse({ sourceUrls: ['https://example.com/news'] });
  assert.equal('executionPassword' in parsed, false);
});

test('settingsSchema also strips unknown fields including any future executionPassword', () => {
  const parsed = settingsSchema.parse({ sources: [], themes: [], executionPassword: 'leak-test' });
  assert.equal('executionPassword' in parsed, false);
});
