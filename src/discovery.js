import { filterArticlesByDate } from './digest-result.js';

function sourceHosts(sourceUrls) {
  return [...new Set(sourceUrls.map((sourceUrl) => new URL(sourceUrl).hostname))];
}

export async function discoverDigest(input, { prefetchArticles, researchWithCodex }, onProgress = () => {}) {
  const sourceCount = input.sourceUrls.length;
  onProgress({ phase: 'prefetching', sourceCount });
  let fetchedArticles = [];
  let sources = null;
  try {
    const res = await prefetchArticles(input.sourceUrls);
    if (res && typeof res === 'object' && 'sources' in res) {
      sources = res.sources;
      fetchedArticles = res.articles || res;
    } else if (Array.isArray(res)) {
      fetchedArticles = res;
    }
  } catch {
    // Prefetch is a server-side candidate signal. Codex web research remains authoritative.
  }

  const articles = filterArticlesByDate(fetchedArticles, input.from, input.to);
  onProgress({ phase: 'prefetched', sourceCount, candidateLinkCount: articles.length });

  onProgress({ phase: 'researching', sourceCount, candidateLinkCount: articles.length, sourceHosts: sourceHosts(input.sourceUrls) });
  const digest = await researchWithCodex({ ...input, articles });
  onProgress({ phase: 'complete', sourceCount, candidateCount: digest.candidates.length });
  return { ...digest, sources: sources || [], researchSources: digest.researchSources || [] };
}

