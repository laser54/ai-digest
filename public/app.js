import { loadSources, saveSources, sourceUrlsForDigest, fetchSettings, saveSettingsToServer } from './source-workspace.js';
import { loadThemes, saveThemes, themesForDigest } from './theme-workspace.js';
import { discoveryProgressMessage } from './discovery-progress.js';
import { readDigestStream } from './digest-response.js';
import { tokenUsageMessage } from './token-usage.js';

const form = document.querySelector('#digest-form');
const status = document.querySelector('#status');
const review = document.querySelector('#review');
const candidates = document.querySelector('#candidates');
const result = document.querySelector('#result');
const links = document.querySelector('#digest-links');
const progressPanel = document.querySelector('#discovery-progress');
const progressDetail = document.querySelector('#discovery-progress-detail');
const prepareButton = document.querySelector('#prepare');
const tokenUsage = document.querySelector('#token-usage');
let articles = [];
let automaticDigestUrls = [];
let sources = loadSources(localStorage);
let themes = loadThemes(localStorage);

const sourceList = document.querySelector('#source-list');
const sourceEmpty = document.querySelector('#source-empty');
const themeList = document.querySelector('#theme-list');
const themeEmpty = document.querySelector('#theme-empty');
const themeInput = document.querySelector('#theme-input');

const syncToServer = async () => {
  try {
    await saveSettingsToServer({ sources, themes });
  } catch (error) {
    console.error('Failed to sync settings to server:', error);
  }
};

const persistSources = (nextSources) => {
  sources = saveSources(localStorage, nextSources);
  renderSources();
  syncToServer();
};

const renderSources = () => {
  sourceEmpty.hidden = sources.length > 0;
  sourceList.replaceChildren(...sources.map((source) => {
    const row = document.createElement('div');
    row.className = 'source-row';
    const label = document.createElement('label');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = source.enabled;
    enabled.addEventListener('change', () => persistSources(sources.map((entry) => entry.url === source.url ? { ...entry, enabled: enabled.checked } : entry)));
    const url = document.createElement('span');
    url.textContent = source.url;
    label.append(enabled, url);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-source';
    remove.textContent = 'Удалить';
    remove.addEventListener('click', () => persistSources(sources.filter((entry) => entry.url !== source.url)));
    row.append(label, remove);
    return row;
  }));
};

const persistThemes = (nextThemes) => {
  themes = saveThemes(localStorage, nextThemes);
  renderThemes();
  syncToServer();
};

const renderThemes = () => {
  themeEmpty.hidden = themes.length > 0;
  themeList.className = 'theme-list';
  themeList.replaceChildren(...themes.map((theme) => {
    const tag = document.createElement('span');
    tag.className = 'theme-tag';
    const label = document.createElement('span');
    label.textContent = theme;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Удалить тематику ${theme}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => persistThemes(themes.filter((entry) => entry !== theme)));
    tag.append(label, remove);
    return tag;
  }));
};

document.querySelector('#source-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#source-url');
  const url = input.value.trim();
  if (!url || sources.some((source) => source.url === url)) return;
  persistSources([...sources, { url, enabled: true }]);
  input.value = '';
});

const initSettings = async () => {
  const localSources = loadSources(localStorage);
  const localThemes = loadThemes(localStorage);
  try {
    const serverSettings = await fetchSettings();
    if (
      serverSettings.sources.length === 0 &&
      serverSettings.themes.length === 0 &&
      (localSources.length > 0 || localThemes.length > 0)
    ) {
      sources = localSources;
      themes = localThemes;
      await saveSettingsToServer({ sources, themes });
    } else {
      sources = saveSources(localStorage, serverSettings.sources);
      themes = saveThemes(localStorage, serverSettings.themes);
    }
  } catch (error) {
    console.warn('Could not fetch server settings, using local fallback:', error);
  } finally {
    renderSources();
    renderThemes();
  }
};

initSettings();

const addTheme = () => {
  const nextThemes = themesForDigest([...themes, themeInput.value]);
  if (nextThemes.length === themes.length) return;
  persistThemes(nextThemes);
  themeInput.value = '';
  themeInput.focus();
};

document.querySelector('#add-theme').addEventListener('click', addTheme);
themeInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  addTheme();
});

const renderDigest = (urls) => {
  const selected = articles.filter((article) => urls.includes(article.url));
  links.replaceChildren(...selected.map((article) => {
    const item = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = article.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = article.title;
    item.append(anchor, article.publishedAt ? ` — ${article.publishedAt}` : '');
    return item;
  }));
  result.hidden = false;
  scrollTo(result);
};

const renderDiscoveryProgress = (event) => {
  progressPanel.hidden = false;
  progressPanel.dataset.phase = event.phase;
  progressDetail.textContent = discoveryProgressMessage(event);
};

const selectedCount = document.querySelector('#selected-count');
const selectAllButton = document.querySelector('#select-all');

const updateSelectedCount = () => {
  const boxes = [...candidates.querySelectorAll('input[type="checkbox"]')];
  const checkedCount = boxes.filter((box) => box.checked).length;
  selectedCount.textContent = boxes.length ? `Отмечено ${checkedCount} из ${boxes.length}` : '';
  selectAllButton.textContent = boxes.length > 0 && checkedCount === boxes.length ? 'Снять все' : 'Выбрать все';
};

candidates.addEventListener('change', updateSelectedCount);

selectAllButton.addEventListener('click', () => {
  const boxes = [...candidates.querySelectorAll('input[type="checkbox"]')];
  const target = boxes.some((box) => !box.checked);
  boxes.forEach((box) => { box.checked = target; });
  updateSelectedCount();
});

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollTo = (element) => element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });

const copyDigest = async () => {
  const lines = [...links.querySelectorAll('a')].map((anchor) => `- [${anchor.textContent}](${anchor.href})`);
  if (!lines.length) return;
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  status.dataset.kind = 'ok';
  status.textContent = `Скопировано ссылок: ${lines.length}.`;
};

document.querySelector('#copy-digest').addEventListener('click', copyDigest);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  form.setAttribute('aria-busy', 'true');
  prepareButton.disabled = true;
  renderDiscoveryProgress({ phase: 'prefetching', sourceCount: sourceUrlsForDigest(sources).length });
  review.hidden = true;
  result.hidden = true;
  tokenUsage.hidden = true;
  status.textContent = '';
  delete status.dataset.kind;
  try {
    const sourceUrls = sourceUrlsForDigest(sources);
    if (!sourceUrls.length) throw new Error('Включите хотя бы один источник для AI-отбора.');
    const response = await fetch('/api/digest/prepare', { method: 'POST', headers: {
      'content-type': 'application/json',
      'x-ai-digest-password': document.querySelector('#execution-password').value
    }, body: JSON.stringify({
      sourceUrls,
      themes: themesForDigest(themes),
      from: document.querySelector('#from').value,
      to: document.querySelector('#to').value
    }) });
    const body = await readDigestStream(response, renderDiscoveryProgress);
    articles = body.articles;
    automaticDigestUrls = body.automaticDigestUrls;
    tokenUsage.textContent = tokenUsageMessage(body.tokenUsage);
    tokenUsage.hidden = false;
    candidates.replaceChildren(...articles.map((article) => {
      const label = document.createElement('label');
      label.className = 'candidate';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.value = article.url;
      const link = document.createElement('a');
      link.href = article.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = article.title;
      const meta = document.createElement('span');
      meta.className = 'candidate-meta';
      const reason = document.createElement('span');
      reason.className = 'candidate-reason';
      reason.textContent = article.reason;
      meta.append(article.publishedAt ? `${article.publishedAt} · ` : '', reason);
      label.append(checkbox, link, meta);
      return label;
    }));
    updateSelectedCount();
    review.hidden = false;
    scrollTo(review);
  } catch (error) {
    progressPanel.dataset.phase = 'error';
    delete status.dataset.kind;
    status.textContent = `Ошибка: ${error.message}`;
  } finally {
    form.removeAttribute('aria-busy');
    prepareButton.disabled = false;
  }
});

document.querySelector('#manual').addEventListener('click', () => renderDigest([...document.querySelectorAll('#candidates input:checked')].map((input) => input.value)));
document.querySelector('#auto').addEventListener('click', () => renderDigest(automaticDigestUrls));
