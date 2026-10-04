import { filterArticlesByDate } from './digest-result.js';
import { AuditLogger } from './logging.js';
import { requiresImplementationEvidence } from './evidence.js';

function sourceHosts(sourceUrls) {
  return [...new Set(sourceUrls.map((sourceUrl) => new URL(sourceUrl).hostname))];
}

export async function discoverDigest(input, { prefetchArticles, researchWithCodex, verifyArticleEvidence, logger }, onProgress = () => {}) {
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

  let candidates = filterArticlesByDate(digest.candidates || [], input.from, input.to);
  if (requiresImplementationEvidence(input.editorialPrompt) && verifyArticleEvidence) {
    let nextIndex = 0;
    const verifyWorker = async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex++;
        const verification = await verifyArticleEvidence(candidates[index]);
        candidates[index] = { ...candidates[index], ...verification };
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, verifyWorker));
  }
  const candidateByUrl = new Map(candidates.map((article) => [article.url, article]));
  const automaticDigestUrls = [...new Set(digest.automaticDigestUrls || [])]
    .filter((url) => candidateByUrl.has(url) && candidateByUrl.get(url).dateStatus !== 'unconfirmed');
  const filteredAutomatic = requiresImplementationEvidence(input.editorialPrompt)
    ? automaticDigestUrls.filter((url) => candidateByUrl.get(url).verification === 'fetched_verified' && candidateByUrl.get(url).autoEligible === true)
    : automaticDigestUrls;
  digest = { ...digest, candidates, automaticDigestUrls: filteredAutomatic };
  const finalCandidateUrls = new Set(candidates.map((article) => article.url));
  for (const source of sources || []) {
    source.articles = (source.articles || []).filter((article) => finalCandidateUrls.has(article.url));
  }
  for (const source of digest.researchSources || []) {
    const hostname = (value) => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; } };
    source.foundCount = candidates.filter((article) => hostname(article.url) === hostname(source.url)).length;
  }
  onProgress({ phase: 'complete', sourceCount, candidateCount: candidates.length });

  const totalDurationMs = Date.now() - reqStart;
  auditLogger.info('digest.request.completed', {
    candidateCount: candidates.length,
    durationMs: totalDurationMs
  });

  return { ...digest, sources: sources || [], researchSources: digest.researchSources || [], requestId: auditLogger.requestId };
}
