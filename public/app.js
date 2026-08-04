import { loadSources, saveSources, sourceUrlsForDigest } from './source-workspace.js';

const form = document.querySelector('#digest-form');
const status = document.querySelector('#status');
const review = document.querySelector('#review');
const candidates = document.querySelector('#candidates');
const result = document.querySelector('#result');
const links = document.querySelector('#digest-links');
let articles = [];
let automaticDigestUrls = [];
let sources = loadSources(localStorage);

const sourceList = document.querySelector('#source-list');
const sourceEmpty = document.querySelector('#source-empty');

const persistSources = (nextSources) => {
  sources = saveSources(localStorage, nextSources);
  renderSources();
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

document.querySelector('#source-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#source-url');
  const url = input.value.trim();
  if (!url || sources.some((source) => source.url === url)) return;
  persistSources([...sources, { url, enabled: true }]);
  input.value = '';
});

renderSources();

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
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = 'Агент читает источники и отбирает кандидатов…';
  review.hidden = true;
  result.hidden = true;
  try {
    const sourceUrls = sourceUrlsForDigest(sources);
    if (!sourceUrls.length) throw new Error('Включите хотя бы один источник для AI-отбора.');
    const response = await fetch('/api/digest/prepare', { method: 'POST', headers: {
      'content-type': 'application/json',
      'x-ai-digest-password': document.querySelector('#execution-password').value
    }, body: JSON.stringify({
      sourceUrls,
      themes: document.querySelector('#themes').value.split(',').map((theme) => theme.trim()).filter(Boolean),
      from: document.querySelector('#from').value,
      to: document.querySelector('#to').value
    }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    articles = body.articles;
    automaticDigestUrls = body.automaticDigestUrls;
    candidates.replaceChildren(...articles.map((article) => {
      const label = document.createElement('label');
      label.className = 'candidate';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.value = article.url;
      const link = document.createElement('a');
      link.href = article.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = article.title;
      label.append(checkbox, link, document.createTextNode(` — ${article.reason}`));
      return label;
    }));
    review.hidden = false;
    status.textContent = `Готово: ${articles.length} кандидатов.`;
  } catch (error) { status.textContent = `Ошибка: ${error.message}`; }
});

document.querySelector('#manual').addEventListener('click', () => renderDigest([...document.querySelectorAll('#candidates input:checked')].map((input) => input.value)));
document.querySelector('#auto').addEventListener('click', () => renderDigest(automaticDigestUrls));
