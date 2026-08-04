function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function filterArticlesByDate(articles, from, to) {
  return articles.filter((article) => {
    if (!article.publishedAt) return true;
    const date = article.publishedAt.slice(0, 10);
    return (!from || date >= from) && (!to || date <= to);
  });
}

export function normalizeAgentResult(raw, fetchedArticles) {
  const allowedByUrl = new Map(fetchedArticles.map((article) => [article.url, article]));
  const seen = new Set();
  const candidates = Array.isArray(raw?.candidates) ? raw.candidates.flatMap((item) => {
    const url = string(item?.url);
    const article = allowedByUrl.get(url);
    if (!article || seen.has(url)) return [];
    seen.add(url);
    return [{
      title: article.title,
      url: article.url,
      publishedAt: article.publishedAt ?? null,
      reason: string(item.reason) || 'Selected by the agent'
    }];
  }) : [];

  const automaticDigestUrls = [...new Set(Array.isArray(raw?.automaticDigestUrls) ? raw.automaticDigestUrls : [])]
    .filter((url) => allowedByUrl.has(url));

  return { candidates, automaticDigestUrls };
}
