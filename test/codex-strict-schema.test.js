import test from 'node:test';
import assert from 'node:assert/strict';
import { codexOutputSchema } from '../src/digest-agent.js';

function assertStrictObjects(schema, location = 'root') {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('object')) {
    assert.equal(schema.additionalProperties, false, location);
    assert.deepEqual([...(schema.required || [])].sort(), Object.keys(schema.properties || {}).sort(), `${location}: strict structured output requires every property, including nullable fields`);
    for (const [key, value] of Object.entries(schema.properties || {})) assertStrictObjects(value, `${location}.${key}`);
  }
  if (schema.items) assertStrictObjects(schema.items, `${location}[]`);
}

test('Codex evidence schema meets the strict structured-output object contract recursively', () => {
  assertStrictObjects(codexOutputSchema());
});

test('evidence may explicitly be null rather than inventing claims for generic topics', () => {
  const evidence = codexOutputSchema().properties.candidates.items.properties.evidence;
  assert.ok(Array.isArray(evidence.type) && evidence.type.includes('null'));
});
