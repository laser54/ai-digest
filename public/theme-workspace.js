export const THEME_SETTINGS_STORAGE_KEY = 'ai-digest.themes.v1';

function splitThemes(themes) {
  if (Array.isArray(themes)) return themes;
  return typeof themes === 'string' ? themes.split(',') : [];
}

export function normalizeThemes(themes) {
  const uniqueThemes = new Set();
  return splitThemes(themes).flatMap((theme) => typeof theme === 'string' ? theme.split(',') : []).flatMap((theme) => {
    if (typeof theme !== 'string') return [];
    const normalized = theme.trim();
    if (!normalized || uniqueThemes.has(normalized)) return [];
    uniqueThemes.add(normalized);
    return [normalized];
  });
}

export function loadThemes(storage) {
  const savedThemes = storage.getItem(THEME_SETTINGS_STORAGE_KEY);
  try {
    return normalizeThemes(JSON.parse(savedThemes || '[]'));
  } catch {
    const legacyThemes = savedThemes?.trim() || '';
    if (legacyThemes.startsWith('[') && legacyThemes.endsWith(']')) return normalizeThemes(legacyThemes.slice(1, -1));
    return legacyThemes.startsWith('{') ? [] : normalizeThemes(legacyThemes);
  }
}

export function saveThemes(storage, themes) {
  const normalized = normalizeThemes(themes);
  storage.setItem(THEME_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function themesForDigest(themes) {
  return normalizeThemes(themes);
}

export { fetchSettings, saveSettingsToServer } from './source-workspace.js';
