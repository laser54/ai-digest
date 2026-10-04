const text = (value) => typeof value === 'string' ? value.trim() : '';

export const canonicalHostsFor = (hostname) => new Set(hostname.startsWith('www.')
  ? [hostname, hostname.slice(4)]
  : [hostname, `www.${hostname}`]);

const hostsFor = (urls) => new Set(urls.flatMap((url) => {
  try { return [...canonicalHostsFor(new URL(url).hostname)]; } catch { return []; }
}));

export function publicationDate(value) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const calendarDate = value.slice(0, 10);
  const calendar = new Date(`${calendarDate}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== calendarDate) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

export function filterArticlesByDate(articles, from, to) {
  return articles.flatMap((article) => {
    const date = publicationDate(article.publishedAt);
    if (!date) return [{ ...article, dateStatus: 'unconfirmed', periodEligible: true }];
    if ((from && date < from) || (to && date > to)) return [];
    return [{ ...article, dateStatus: 'in_period', periodEligible: true }];
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
      reason: text(item.reason) || 'Selected by the agent',
      evidence: article?.evidence || (item?.evidence && typeof item.evidence === 'object' ? item.evidence : null),
      verification: article?.verification === 'fetched_verified' ? 'fetched_verified'
        : (article?.evidence || item?.evidence) ? 'search_evidence_only' : 'unverified'
    }];
  });
  const candidateUrls = new Set(candidates.map((article) => article.url));
  return {
    candidates,
    automaticDigestUrls: [...new Set(Array.isArray(raw?.automaticDigestUrls) ? raw.automaticDigestUrls : [])]
      .filter((url) => candidateUrls.has(url) && candidates.find((article) => article.url === url)?.dateStatus !== 'unconfirmed')
  };
}
