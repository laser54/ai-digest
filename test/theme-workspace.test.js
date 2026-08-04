import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadThemes,
  saveThemes,
  themesForDigest,
  THEME_SETTINGS_STORAGE_KEY
} from '../public/theme-workspace.js';

function memoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem(key) {
      assert.equal(key, THEME_SETTINGS_STORAGE_KEY);
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, THEME_SETTINGS_STORAGE_KEY);
      value = nextValue;
    }
  };
}

test('loads persistent theme tags and safely falls back for malformed browser storage', () => {
  assert.deepEqual(loadThemes(memoryStorage(JSON.stringify(['AI', 'Продукты']))), ['AI', 'Продукты']);
  assert.deepEqual(loadThemes(memoryStorage('{invalid json')), []);
});

test('normalizes legacy comma-separated themes and saves unique tags without unrelated settings', () => {
  const storage = memoryStorage('AI, продукты, AI');
  assert.deepEqual(loadThemes(storage), ['AI', 'продукты']);

  const themes = saveThemes(storage, [' AI ', 'продукты', '', 'AI']);
  assert.deepEqual(themes, ['AI', 'продукты']);
  assert.deepEqual(JSON.parse(storage.getItem(THEME_SETTINGS_STORAGE_KEY)), themes);
});

test('migrates bracketed legacy comma-separated themes without dropping selections', () => {
  assert.deepEqual(loadThemes(memoryStorage('[AI, продукты]')), ['AI', 'продукты']);
});

test('passes all selected theme tags to the digest request', () => {
  assert.deepEqual(themesForDigest(['AI, Продукты', 'AI']), ['AI', 'Продукты']);
});
