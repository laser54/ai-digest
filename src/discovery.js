import { filterArticlesByDate } from './digest-result.js';
import { AuditLogger } from './logging.js';

function sourceHosts(sourceUrls) {
  return [...new Set(sourceUrls.map((sourceUrl) => new URL(sourceUrl).hostname))];
}

export async function discoverDigest(input, { prefetchArticles, researchWithCodex, logger }, onProgress = () => {}) {
  const auditLogger = logger || new AuditLogger();
  const reqStart = Date.now();
  const sourceCount = input.sourceUrls.length;
  auditLogger.info('digest.request.started', {
    sourceCount,
    themesCount: (input.themes || []).length,
    hasFrom: Boolean(input.from),
    hasTo: Boolean(input.to)
  });

  onProgress({ phase: 'prefetching', sourceCount });
  const prefetchStart = Date.now();
  auditLogger.info('digest.prefetch.started', { sourceCount });
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
  } catch (err) {
    auditLogger.warn('digest.prefetch.failed', {
      errorName: err?.name || 'PrefetchFailed',
      errorStatus: err?.status || 'unknown'
    });
  }

  const prefetchDurationMs = Date.now() - prefetchStart;
  const articles = filterArticlesByDate(fetchedArticles, input.from, input.to);
  onProgress({ phase: 'prefetched', sourceCount, candidateLinkCount: articles.length });

  auditLogger.info('digest.prefetch.completed', {
    sourceCount,
    candidateLinkCount: articles.length,
    durationMs: prefetchDurationMs,
    successfulSources: sources ? sources.filter((s) => s.status === 'fetched' || s.status === 'no_articles').length : null,
    failedSources: sources ? sources.filter((s) => s.status !== 'fetched' && s.status !== 'no_articles').length : null
  });

  const hosts = sourceHosts(input.sourceUrls);
  onProgress({ phase: 'researching', sourceCount, candidateLinkCount: articles.length, sourceHosts: hosts });
  const codexStart = Date.now();
  auditLogger.info('digest.codex.started', { sourceCount, candidateLinkCount: articles.length, sourceHosts: hosts });

  let digest;
  try {
    digest = await researchWithCodex({ ...input, articles, logger: auditLogger });
  } catch (err) {
    auditLogger.error('digest.codex.failed', {
      errorName: err?.name || 'CodexResearchFailed',
      errorStatus: err?.status || 'unknown'
    });
    throw err;
  }

  const codexDurationMs = Date.now() - codexStart;
  auditLogger.info('digest.codex.completed', {
    candidateCount: digest.candidates.length,
    automaticDigestCount: (digest.automaticDigestUrls || []).length,
    tokenUsageAvailable: Boolean(digest.tokenUsage?.available),
    timedOutSourceCount: digest.timedOutSourceCount || 0,
    researchTimeoutMs: digest.researchTimeoutMs || null,
    durationMs: codexDurationMs
  });

  if ((digest.timedOutSourceCount || 0) > 0) {
    auditLogger.warn('digest.codex.timeout', {
      timedOutSourceCount: digest.timedOutSourceCount,
      researchTimeoutMs: digest.researchTimeoutMs || null,
      totalSourceCount: input.sourceUrls.length
    });
  }

  onProgress({ phase: 'complete', sourceCount, candidateCount: digest.candidates.length });

  const totalDurationMs = Date.now() - reqStart;
  auditLogger.info('digest.request.completed', {
    candidateCount: digest.candidates.length,
    durationMs: totalDurationMs
  });

  return { ...digest, sources: sources || [], researchSources: digest.researchSources || [], requestId: auditLogger.requestId };
}
