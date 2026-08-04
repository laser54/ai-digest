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
