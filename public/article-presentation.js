export function articleSourceLabel(url) {
  try {
    const parsed = new URL(url);
    return `Источник: ${parsed.hostname || 'неизвестен'}`;
  } catch {
    return 'Источник: неизвестен';
  }
}

export function createArticleSource(url, context) {
  const source = document.createElement('span');
  source.className = `article-source article-source-${context}`;
  source.textContent = articleSourceLabel(url);
  return source;
}
