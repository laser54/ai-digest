import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSources,
  saveSources,
  sourceUrlsForDigest,
  SOURCE_SETTINGS_STORAGE_KEY
} from '../public/source-workspace.js';

function memoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem(key) {
      assert.equal(key, SOURCE_SETTINGS_STORAGE_KEY);
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, SOURCE_SETTINGS_STORAGE_KEY);
      value = nextValue;
    }
  };
}

test('loads saved approved sources and safely falls back for malformed browser storage', () => {
  assert.deepEqual(loadSources(memoryStorage(JSON.stringify([
    { url: 'https://example.com/news', enabled: true },
    { url: 'https://example.org/feed', enabled: false }
  ]))), [
    { url: 'https://example.com/news', enabled: true },
    { url: 'https://example.org/feed', enabled: false }
  ]);
  assert.deepEqual(loadSources(memoryStorage('{invalid json')), []);
});

test('saves only normalized non-secret source configuration', () => {
  const storage = memoryStorage();
  const sources = saveSources(storage, [
    { url: ' https://example.com/news ', enabled: true, password: 'do not persist' },
    { url: 'https://example.com/news', enabled: false },
    { url: '', enabled: true }
  ]);

  assert.deepEqual(sources, [{ url: 'https://example.com/news', enabled: true }]);
  assert.deepEqual(JSON.parse(storage.getItem(SOURCE_SETTINGS_STORAGE_KEY)), sources);
});

test('passes only enabled approved sources to the digest request', () => {
  assert.deepEqual(sourceUrlsForDigest([
    { url: 'https://example.com/news', enabled: true },
    { url: 'https://example.org/feed', enabled: false }
  ]), ['https://example.com/news']);
});
