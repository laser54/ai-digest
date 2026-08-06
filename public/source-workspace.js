export const SOURCE_SETTINGS_STORAGE_KEY = 'ai-digest.sources.v1';

function normalizeSource(source) {
  const url = typeof source === 'string' ? source : source?.url;
  if (typeof url !== 'string' || !url.trim()) return null;
  return { url: url.trim(), enabled: source?.enabled !== false };
}

export function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  const uniqueUrls = new Set();
  return sources.flatMap((source) => {
    const normalized = normalizeSource(source);
    if (!normalized || uniqueUrls.has(normalized.url)) return [];
    uniqueUrls.add(normalized.url);
    return [normalized];
  });
}

export function loadSources(storage) {
  try {
    return normalizeSources(JSON.parse(storage.getItem(SOURCE_SETTINGS_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function saveSources(storage, sources) {
  const normalized = normalizeSources(sources);
  storage.setItem(SOURCE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function sourceUrlsForDigest(sources) {
  return normalizeSources(sources).filter((source) => source.enabled).map((source) => source.url);
}

export async function fetchSettings() {
  const response = await fetch('/api/settings');
  if (!response.ok) throw new Error('Не удалось загрузить настройки с сервера');
  return response.json();
}

export async function saveSettingsToServer(settings) {
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings)
  });
  if (!response.ok) throw new Error('Не удалось сохранить настройки на сервере');
  return response.json();
}
