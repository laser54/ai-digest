import { createArticleSource } from './article-presentation.js';
import { safeHttpUrl } from './safe-links.js';

export function renderArticleCard(article, { selected = false } = {}) {
  const label = document.createElement('label');
  label.className = 'candidate';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.value = article.url; checkbox.checked = selected;
  const nodes = [checkbox];
  const href = safeHttpUrl(article.url);
  if (href) {
    const link = document.createElement('a');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = article.title;
    nodes.push(link);
  }
  nodes.push(createArticleSource(article.url, 'candidate'));
  const verification = { fetched_verified: 'Проверено по тексту страницы', search_evidence_only: 'Есть только поисковое свидетельство', unverified: 'Не проверено; требуется ручная проверка' }[article.verification] || 'Не проверено; требуется ручная проверка';
  const meta = document.createElement('span');
  meta.className = 'candidate-meta';
  meta.textContent = `${article.dateStatus === 'unconfirmed' ? 'Период не подтверждён · ' : ''}${article.publishedAt || 'Дата не подтверждена'} · ${verification} · ${article.reason || ''}`;
  nodes.push(meta);
  const evidence = article.evidence || {};
  const details = [evidence.organization, evidence.technology, evidence.implementation, evidence.stage,
    evidence.excerpt, evidence.url ? `Проверяемый URL: ${evidence.url}` : '', evidence.publishedAt,
    evidence.dateProvenance ? `Происхождение даты: ${evidence.dateProvenance}` : '',
    article.fetchStatus ? `Загрузка: ${article.fetchStatus}` : '',
    `Неопределённость: ${article.uncertainty || (article.verification === 'fetched_verified' ? 'по pipeline-проверке не выявлена' : 'сохраняется; требуется ручная проверка')}`,
    `Уверенность в утверждении: ${article.claimConfidence || 'независимо не оценена'}`,
    `Уверенность в дате: ${article.dateConfidence || (evidence.dateProvenance ? 'подтверждена метаданными страницы' : 'дата не подтверждена независимо')}`];
  const status = document.createElement('span');
  status.className = 'candidate-meta';
  status.textContent = details.filter(Boolean).join(' · ') || 'Сведения о проверке отсутствуют; требуется ручная проверка.';
  nodes.push(status);
  label.append(...nodes);
  return label;
}
