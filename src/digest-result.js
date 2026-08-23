const text = (value) => typeof value === 'string' ? value.trim() : '';

export const canonicalHostsFor = (hostname) => new Set(hostname.startsWith('www.')
  ? [hostname, hostname.slice(4)]
  : [hostname, `www.${hostname}`]);

const hostsFor = (urls) => new Set(urls.flatMap((url) => {
  try { return [...canonicalHostsFor(new URL(url).hostname)]; } catch { return []; }
}));

export function filterArticlesByDate(articles, from, to) {
  return articles.filter((article) => {
    if (!article.publishedAt) return true;
    const date = article.publishedAt.slice(0, 10);
    return (!from || date >= from) && (!to || date <= to);
  });
}

export function normalizeAgentResult(raw, fetchedArticles, sourceUrls = []) {
  const fetched = new Map(fetchedArticles.map((article) => [article.url, article]));
  const hosts = hostsFor(sourceUrls);
  const seen = new Set();
  const candidates = (Array.isArray(raw?.candidates) ? raw.candidates : []).flatMap((item) => {
    const url = text(item?.url);
    let parsed;
    try { parsed = new URL(url); } catch { return []; }
    const article = fetched.get(url);
    const allowed = article || (parsed.protocol === 'https:' && !parsed.username && !parsed.password && hosts.has(parsed.hostname));
    if (!allowed || seen.has(url)) return [];
    seen.add(url);
    return [{
      title: article?.title || text(item.title) || url,
      url,
      publishedAt: article?.publishedAt ?? (text(item.publishedAt) || null),
      reason: text(item.reason) || 'Selected by the agent'
    }];
  });
  const candidateUrls = new Set(candidates.map((article) => article.url));
  return {
    candidates,
    automaticDigestUrls: [...new Set(Array.isArray(raw?.automaticDigestUrls) ? raw.automaticDigestUrls : [])]
      .filter((url) => candidateUrls.has(url))
  };
}
