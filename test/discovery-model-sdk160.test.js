import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDiscoveryModel, codexThreadOptions } from '../src/digest-agent.js';

test('service defaults to the SDK160-compatible gpt-6-luna without auto-downgrading', () => {
  assert.equal(selectDiscoveryModel({}), 'gpt-6-luna');
  assert.equal(selectDiscoveryModel({ CODEX_DISCOVERY_MODEL: 'gpt-5.6-luna' }), 'gpt-6-luna');
  assert.equal(selectDiscoveryModel({ CODEX_DISCOVERY_MODEL: 'unknown' }), 'gpt-6-luna');
});

test('research thread preserves read-only isolation with the new explicit model', () => {
  const options = codexThreadOptions('gpt-6-luna');
  assert.equal(options.model, 'gpt-6-luna');
  assert.equal(options.sandboxMode, 'read-only');
  assert.equal(options.approvalPolicy, 'never');
  assert.equal(options.webSearchEnabled, true);
});
