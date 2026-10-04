import { loadSources, saveSources, sourceUrlsForDigest, fetchSettings, saveSettingsToServer } from './source-workspace.js';
import { loadThemes, saveThemes, themesForDigest } from './theme-workspace.js';
import { discoveryProgressMessage } from './discovery-progress.js';
import { startAndPollDigest } from './digest-polling.js';
import { tokenUsageMessage } from './token-usage.js';
import { renderSourceReport } from './source-report.js';

import { formatDigestForClipboard } from './digest-clipboard.js';
import { loadEditorialPrompt, saveEditorialPrompt } from './editorial-prompt-workspace.js';
import { isRetryEligibleOutcome, safeHttpUrl } from './safe-links.js';
import { renderArticleCard } from './article-card.js';
import { renderNextPageButton } from './history-pagination.js';

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
const sourceReportContainer = document.querySelector('#source-report');
let articles = [];
let automaticDigestUrls = [];
let sources = loadSources(localStorage);
let themes = loadThemes(localStorage);
let editorialPrompt = loadEditorialPrompt(localStorage);
let historyRecord = null;
let historyCursor = null;
const historyList = document.querySelector('#history-list');
const historyStatus = document.querySelector('#history-status');
const retryPanel = document.querySelector('#retry-panel');
const retrySources = document.querySelector('#retry-sources');
const retryAttempts = document.querySelector('#retry-attempts');
const retryStatus = document.querySelector('#retry-status');
const retryStart = document.querySelector('#retry-start');
const executionPassword = () => document.querySelector('#execution-password').value;

function renderRetryPanel() {
  if (!historyRecord) { retryPanel.hidden = true; return; }
  retryPanel.hidden = false;
  const retryable = (historyRecord.result.researchSources || []).filter((source) => isRetryEligibleOutcome(source.outcome));
  retrySources.replaceChildren(...retryable.map((source) => {
    const label = document.createElement('label'); label.className = 'candidate';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = source.url;
    const text = document.createElement('span'); text.textContent = `${source.url} · ${source.outcome} · ${source.error || 'Источник недоступен'}`;
    label.append(checkbox, text); return label;
  }));
  retryStart.disabled = retryable.length === 0;
  retryAttempts.replaceChildren(...(historyRecord.attempts || []).map((attempt) => {
    const row = document.createElement('p');
    row.textContent = `${attempt.status} · ${new Date(attempt.createdAt).toLocaleString()} · ${attempt.selectedSourceUrls.join(', ')}${attempt.error ? ` · ${attempt.error}` : ''}`;
    return row;
  }));
  if (!retryable.length && !(historyRecord.attempts || []).length) retryStatus.textContent = 'Нет источников, доступных для повтора.';
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function trackRetry(jobId, digestId) {
  for (let poll = 0; poll < 180; poll += 1) {
    await delay(2000);
    try {
      const state = await historyRequest('/api/digest/jobs/status', 'POST', { jobId });
      if (state.status === 'complete' || state.status === 'error') {
        await historySaveChain;
        const saved = await historyRequest(`/api/digests/${encodeURIComponent(digestId)}/read`, 'POST', {});
        if (historyRecord?.id !== digestId) return;
        const selected = [...candidates.querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value).sort();
        const clean = document.querySelector('#editorial-draft').value === (historyRecord.editorialDraft || '')
          && JSON.stringify(selected) === JSON.stringify([...(historyRecord.selectedUrls || [])].sort());
        if (!clean) {
          retryStatus.textContent = 'Повтор завершён; результат сохранён. Сохраните текущие правки и заново откройте выпуск для обновления карточек.';
          return;
        }
        historyRecord = saved;
        articles = saved.result.articles || [];
        automaticDigestUrls = saved.result.automaticDigestUrls || [];
        candidates.replaceChildren(...articles.map((article) => renderArticleCard(article, { selected: saved.selectedUrls.includes(article.url) })));
        document.querySelector('#editorial-draft').value = saved.editorialDraft || '';
        updateSelectedCount();
        renderRetryPanel();
        retryStatus.textContent = state.status === 'complete' ? 'Повтор завершён; результат объединён с сохранённым выпуском.' : 'Повтор завершился ошибкой; прежний результат сохранён.';
        return;
      }
      retryStatus.textContent = `Повтор выполняется: ${state.status}.`;
    } catch (error) { retryStatus.textContent = `Статус повтора пока недоступен: ${error.message}`; return; }
  }
}

retryStart.addEventListener('click', async () => {
  if (!historyRecord) return;
  const selectedSourceUrls = [...retrySources.querySelectorAll('input:checked')].map((input) => input.value);
  if (!selectedSourceUrls.length) { retryStatus.textContent = 'Выберите хотя бы один источник.'; return; }
  if (!executionPassword()) { retryStatus.textContent = 'Введите пароль для авторизации.'; return; }
  retryStart.disabled = true;
  retryStatus.textContent = 'Запуск повтора…';
  const key = `digest-retry-${historyRecord.id}`;
  const sameSelection = (attempt) => JSON.stringify([...attempt].sort()) === JSON.stringify([...selectedSourceUrls].sort());
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { pending = null; }
  const existing = pending && sameSelection(pending.selectedSourceUrls)
    ? (historyRecord.attempts || []).find((attempt) => attempt.submissionId === pending.submissionId) : null;
  if (!pending || !sameSelection(pending.selectedSourceUrls) || (existing && ['complete', 'error', 'interrupted'].includes(existing.status))) {
    pending = { submissionId: `retry_${crypto.randomUUID().replaceAll('-', '')}`, selectedSourceUrls };
    sessionStorage.setItem(key, JSON.stringify(pending));
  }
  try {
    const response = await historyRequest(`/api/digests/${encodeURIComponent(historyRecord.id)}/retries`, 'POST', {
      revision: historyRecord.revision, submissionId: pending.submissionId, selectedSourceUrls
    });
    retryStatus.textContent = `Повтор ${response.status || 'запущен'}${response.reused ? ' (существующая попытка)' : ''}.`;
    historyRecord = await historyRequest(`/api/digests/${encodeURIComponent(historyRecord.id)}/read`, 'POST', {});
    renderRetryPanel();
    if (response.jobId) trackRetry(response.jobId, historyRecord.id);
  } catch (error) {
    retryStatus.textContent = `Не удалось запустить повтор: ${error.message}`;
    if (error.code === 'history_revision_conflict') historyRecord = await historyRequest(`/api/digests/${encodeURIComponent(historyRecord.id)}/read`, 'POST', {}).catch(() => historyRecord);
  } finally { retryStart.disabled = false; }
});

async function historyRequest(url, method = 'GET', data) {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify({ ...data, executionPassword: executionPassword() }) })
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(body?.error || 'Ошибка истории выпусков');
    if (typeof body?.code === 'string') error.code = body.code;
    throw error;
  }
  return body;
}

async function refreshHistory(cursor = null) {
  try {
    historyCursor = cursor;
    const page = await historyRequest('/api/digests/list', 'POST', { limit: 20, ...(cursor ? { cursor } : {}) });
    historyList.replaceChildren(...page.items.map((item) => {
      const row = document.createElement('div');
      const open = document.createElement('button');
      open.type = 'button'; open.textContent = `${item.name} · ${new Date(item.createdAt).toLocaleDateString()} · ${item.status || 'complete'}`;
      open.addEventListener('click', async () => {
        try {
          historyRecord = await historyRequest(`/api/digests/${encodeURIComponent(item.id)}/read`, 'POST', {});
          articles = historyRecord.result.articles || [];
          automaticDigestUrls = historyRecord.result.automaticDigestUrls || [];
          renderRetryPanel();
          document.querySelector('#editorial-draft').value = historyRecord.editorialDraft || '';
          candidates.replaceChildren(...articles.map((article) => renderArticleCard(article, { selected: historyRecord.selectedUrls.includes(article.url) })));
          review.hidden = false; result.hidden = true;
          historyStatus.textContent = `Открыт выпуск «${historyRecord.name}».`;
          updateSelectedCount();
        } catch (error) { historyStatus.textContent = error.message; }
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Удалить';
      remove.addEventListener('click', async () => {
        if (!confirm(`Удалить выпуск «${item.name}»? Это действие необратимо.`)) return;
        try { await historyRequest(`/api/digests/${encodeURIComponent(item.id)}`, 'DELETE', { revision: item.revision }); await refreshHistory(); }
        catch (error) { historyStatus.textContent = error.message; }
      });
      const rename = document.createElement('button'); rename.type = 'button'; rename.textContent = 'Переименовать';
      rename.addEventListener('click', async () => {
        const name = prompt('Название выпуска', item.name);
        if (name === null) return;
        try { await historyRequest(`/api/digests/${encodeURIComponent(item.id)}`, 'PATCH', { revision: item.revision, name }); await refreshHistory(historyCursor); }
        catch (error) { historyStatus.textContent = error.message; }
      });
      row.append(open, rename, remove); return row;
    }));
    renderNextPageButton(historyList, page.nextCursor, refreshHistory);
    if (!page.items.length) historyStatus.textContent = 'История пока пуста.';
  } catch (error) { historyStatus.textContent = `История недоступна: ${error.message}`; }
}

document.querySelector('#history-refresh').addEventListener('click', () => refreshHistory());
document.querySelector('#execution-password').addEventListener('change', () => {
  if (executionPassword()) refreshHistory();
});
refreshHistory();

let historySaveChain = Promise.resolve();
async function saveHistoryEdits() {
  if (!historyRecord) return;
  historyStatus.textContent = 'Сохранение…';
  historySaveChain = historySaveChain.then(async () => {
    const patch = {
      revision: historyRecord.revision,
      selectedUrls: [...candidates.querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value),
      editorialDraft: document.querySelector('#editorial-draft').value
    };
    historyRecord = await historyRequest(`/api/digests/${encodeURIComponent(historyRecord.id)}`, 'PATCH', patch);
    historyStatus.textContent = 'Сохранено.';
  }).catch((error) => { historyStatus.textContent = `Не сохранено: ${error.message}`; });
  return historySaveChain;
}
document.querySelector('#editorial-draft').addEventListener('change', saveHistoryEdits);

const sourceList = document.querySelector('#source-list');
const sourceEmpty = document.querySelector('#source-empty');
const themeList = document.querySelector('#theme-list');
const themeEmpty = document.querySelector('#theme-empty');
const themeInput = document.querySelector('#theme-input');
const editorialPromptInput = document.querySelector('#editorial-prompt');

const syncToServer = async () => {
  try {
    await saveSettingsToServer({ sources, themes, editorialPrompt });
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
  const localEditorialPrompt = loadEditorialPrompt(localStorage);
  try {
    const serverSettings = await fetchSettings();
    if (
      serverSettings.sources.length === 0 &&
      serverSettings.themes.length === 0 &&
      !serverSettings.editorialPrompt &&
      (localSources.length > 0 || localThemes.length > 0 || localEditorialPrompt)
    ) {
      sources = localSources;
      themes = localThemes;
      editorialPrompt = localEditorialPrompt;
      await saveSettingsToServer({ sources, themes, editorialPrompt });
    } else {
      sources = saveSources(localStorage, serverSettings.sources);
      themes = saveThemes(localStorage, serverSettings.themes);
      editorialPrompt = saveEditorialPrompt(localStorage, serverSettings.editorialPrompt);
    }
  } catch (error) {
    console.warn('Could not fetch server settings, using local fallback:', error);
  } finally {
    renderSources();
    renderThemes();
    editorialPromptInput.value = editorialPrompt;
  }
};

initSettings();

editorialPromptInput.addEventListener('change', () => {
  editorialPrompt = saveEditorialPrompt(localStorage, editorialPromptInput.value);
  editorialPromptInput.value = editorialPrompt;
  syncToServer();
});

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
    const anchor = safeAnchor(article.url, article.title);
    if (anchor) item.append(anchor);
    item.append(article.publishedAt ? ` — ${article.publishedAt}` : '', createArticleSource(article.url, 'digest'));
    return item;
  }));
  result.hidden = false;
  scrollTo(result);
};

function safeAnchor(url, title) {
  const href = safeHttpUrl(url);
  if (!href) return null;
  const anchor = document.createElement('a');
  anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = title;
  return anchor;
}


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
candidates.addEventListener('change', saveHistoryEdits);

selectAllButton.addEventListener('click', () => {
  const boxes = [...candidates.querySelectorAll('input[type="checkbox"]')];
  const target = boxes.some((box) => !box.checked);
  boxes.forEach((box) => { box.checked = target; });
  updateSelectedCount();
  saveHistoryEdits();
});

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollTo = (element) => element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });

const copyDigest = async () => {
  const items = [...links.querySelectorAll('a')].map((anchor) => ({ title: anchor.textContent, url: anchor.href }));
  const text = formatDigestForClipboard(items);
  if (!text) return;
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
  status.textContent = `Скопировано ссылок: ${items.length}.`;
};

document.querySelector('#copy-digest').addEventListener('click', copyDigest);

document.querySelector('#export-markdown').addEventListener('click', () => {
  const markdown = [...links.querySelectorAll('a')].map((anchor, index) => {
    const title = anchor.textContent.replace(/([\\[\\]])/g, '\\$1');
    return `${index + 1}. [${title}](${anchor.href})`;
  }).join('\n');
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = 'ai-digest.md'; link.click();
  URL.revokeObjectURL(link.href);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  form.setAttribute('aria-busy', 'true');
  prepareButton.disabled = true;
  renderDiscoveryProgress({ phase: 'queued' });
  review.hidden = true;
  result.hidden = true;
  tokenUsage.hidden = true;
  if (sourceReportContainer) sourceReportContainer.hidden = true;
  status.textContent = '';
  delete status.dataset.kind;
  try {
    const sourceUrls = sourceUrlsForDigest(sources);
    if (!sourceUrls.length) throw new Error('Включите хотя бы один источник для AI-отбора.');
    const body = await startAndPollDigest({
      sourceUrls,
      themes: themesForDigest(themes),
      editorialPrompt,
      from: document.querySelector('#from').value,
      to: document.querySelector('#to').value,
      executionPassword: document.querySelector('#execution-password').value
    }, { onProgress: renderDiscoveryProgress });
    articles = body.articles;
    automaticDigestUrls = body.automaticDigestUrls;
    historyStatus.textContent = 'Сохранение выпуска…';
    historyRecord = null;
    try {
      if (body.historyId) historyRecord = await historyRequest(`/api/digests/${encodeURIComponent(body.historyId)}/read`, 'POST', {});
      else historyRecord = await historyRequest('/api/digests', 'POST', {
          name: `Выпуск ${new Date().toLocaleString()}`,
          snapshot: { sourceUrls, themes: themesForDigest(themes), editorialPrompt, from: document.querySelector('#from').value, to: document.querySelector('#to').value },
          result: body,
          selectedUrls: [],
          editorialDraft: ''
        });
      historyStatus.textContent = 'Выпуск сохранён. Отбор и черновик будут сохраняться автоматически.';
      await refreshHistory();
      renderRetryPanel();
    } catch (error) { historyStatus.textContent = `Выпуск получен, но не сохранён: ${error.message}`; }
    tokenUsage.textContent = tokenUsageMessage(body.tokenUsage);
    tokenUsage.hidden = false;
    if (sourceReportContainer) {
      renderSourceReport(sourceReportContainer, body.sources, body.researchSources);
      sourceReportContainer.hidden = false;
    }
    candidates.replaceChildren(...articles.map((article) => renderArticleCard(article)));
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
document.querySelector('#auto').addEventListener('click', () => {
  const selected = new Set(automaticDigestUrls);
  candidates.querySelectorAll('input[type="checkbox"]').forEach((box) => { box.checked = selected.has(box.value); });
  updateSelectedCount();
  saveHistoryEdits();
  renderDigest(automaticDigestUrls);
});
