const form = document.querySelector('#digest-form');
const status = document.querySelector('#status');
const review = document.querySelector('#review');
const candidates = document.querySelector('#candidates');
const result = document.querySelector('#result');
const links = document.querySelector('#digest-links');
let articles = [];
let automaticDigestUrls = [];

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
    const response = await fetch('/api/digest/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      sourceUrls: document.querySelector('#sources').value.split(/\n|,/).map((url) => url.trim()).filter(Boolean),
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
