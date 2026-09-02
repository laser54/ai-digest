import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITORIAL_PROMPT_STORAGE_KEY,
  loadEditorialPrompt,
  saveEditorialPrompt
} from '../public/editorial-prompt-workspace.js';

function memoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem(key) { assert.equal(key, EDITORIAL_PROMPT_STORAGE_KEY); return value; },
    setItem(key, nextValue) { assert.equal(key, EDITORIAL_PROMPT_STORAGE_KEY); value = nextValue; }
  };
}

test('editorial prompt survives browser persistence with trimming and a 4000 character limit', () => {
  const storage = memoryStorage();
  assert.equal(saveEditorialPrompt(storage, '  Фактические внедрения  '), 'Фактические внедрения');
  assert.equal(loadEditorialPrompt(storage), 'Фактические внедрения');
  assert.equal(saveEditorialPrompt(storage, ` ${'я'.repeat(4001)} `).length, 4000);
});

test('editorial prompt browser persistence safely defaults for non-string values', () => {
  assert.equal(loadEditorialPrompt(memoryStorage(null)), '');
  assert.equal(saveEditorialPrompt(memoryStorage(), undefined), '');
});
