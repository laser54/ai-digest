export const EDITORIAL_PROMPT_STORAGE_KEY = 'ai-digest.editorialPrompt.v1';

export function normalizeEditorialPrompt(value) {
  return typeof value === 'string' ? value.trim().slice(0, 4000) : '';
}

export function loadEditorialPrompt(storage) {
  return normalizeEditorialPrompt(storage.getItem(EDITORIAL_PROMPT_STORAGE_KEY));
}

export function saveEditorialPrompt(storage, value) {
  const normalized = normalizeEditorialPrompt(value);
  storage.setItem(EDITORIAL_PROMPT_STORAGE_KEY, normalized);
  return normalized;
}
