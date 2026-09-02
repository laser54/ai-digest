import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const normalizeEditorialPrompt = (value) => typeof value === 'string' ? value.trim().slice(0, 4000) : '';

export function getSettingsFilePath() {
  if (process.env.SETTINGS_FILE) {
    return process.env.SETTINGS_FILE;
  }
  const baseDir = process.env.CODEX_HOME || process.env.HOME || path.join(process.cwd(), 'data');
  return path.join(baseDir, 'settings.json');
}

export async function readSettings() {
  const filePath = getSettingsFilePath();
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      sources: Array.isArray(parsed?.sources) ? parsed.sources : [],
      themes: Array.isArray(parsed?.themes) ? parsed.themes : [],
      editorialPrompt: normalizeEditorialPrompt(parsed?.editorialPrompt)
    };
  } catch {
    return { sources: [], themes: [], editorialPrompt: '' };
  }
}

export async function writeSettings(settings) {
  const filePath = getSettingsFilePath();
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const data = {
    sources: Array.isArray(settings?.sources) ? settings.sources : [],
    themes: Array.isArray(settings?.themes) ? settings.themes : [],
    editorialPrompt: normalizeEditorialPrompt(settings?.editorialPrompt)
  };

  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}
