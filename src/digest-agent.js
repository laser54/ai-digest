import { normalizeAgentResult } from './digest-result.js';

export const CODEX_DISCOVERY_LUNA_MODEL = 'gpt-5.6-luna';
export const CODEX_DISCOVERY_FALLBACK_MODEL = 'gpt-5.6-terra';

export function selectDiscoveryModel(environment = process.env) {
  const requestedModel = environment.CODEX_DISCOVERY_MODEL;
  return requestedModel === CODEX_DISCOVERY_FALLBACK_MODEL
    ? CODEX_DISCOVERY_FALLBACK_MODEL
    : CODEX_DISCOVERY_LUNA_MODEL;
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Codex did not return JSON');
  return JSON.parse(match[0]);
}

export function codexThreadOptions(model = selectDiscoveryModel()) {
  return {
    model,
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    sandboxMode: 'read-only',
    networkAccessEnabled: true,
    webSearchEnabled: true
  };
}

export function codexOutputSchema() {
  return {
    type: 'object', additionalProperties: false,
    required: ['candidates', 'automaticDigestUrls', 'checkedCount', 'outcome'],
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['url', 'title', 'publishedAt', 'reason'],
          properties: {
            url: { type: 'string' },
            title: { type: 'string' },
            publishedAt: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      },
      automaticDigestUrls: { type: 'array', items: { type: 'string' } },
      checkedCount: { type: 'integer', minimum: 0 },
      outcome: {
        type: 'string',
        enum: ['researched', 'no_relevant_articles', 'unreachable_from_research', 'blocked', 'unsupported']
      }
    }
  };
}

const usageFields = {
  input_tokens: 'inputTokens',
  cached_input_tokens: 'cachedInputTokens',
  cache_write_input_tokens: 'cacheWriteInputTokens',
  output_tokens: 'outputTokens',
  reasoning_output_tokens: 'reasoningOutputTokens'
};

export function normalizeCodexUsage(usage) {
  if (!usage || typeof usage !== 'object') return { available: false };

  const normalized = Object.fromEntries(Object.entries(usageFields).map(([sdkName, publicName]) => [publicName, usage[sdkName]]));
  if (!Object.values(normalized).every((value) => Number.isSafeInteger(value) && value >= 0)) return { available: false };
  return { available: true, ...normalized };
}

export function aggregateCodexUsage(usages) {
  if (!usages || !usages.length) return { available: false };
  if (usages.some(u => !u || !u.available)) return { available: false };

  const aggregated = {
    available: true,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0
  };

  for (const usage of usages) {
    aggregated.inputTokens += usage.inputTokens;
    aggregated.cachedInputTokens += usage.cachedInputTokens;
    aggregated.cacheWriteInputTokens += usage.cacheWriteInputTokens;
    aggregated.outputTokens += usage.outputTokens;
    aggregated.reasoningOutputTokens += usage.reasoningOutputTokens;
  }

  return aggregated;
}

export async function rankArticlesWithCodex({ articles = [], sourceUrls = [], themes = [], from, to, _mockRun, _timeoutMs }) {
  const defaultTimeoutMs = 60_000;
  const envMs = Number(process.env.CODEX_RESEARCH_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(_timeoutMs) && _timeoutMs > 0
    ? _timeoutMs
    : (Number.isInteger(envMs) && envMs > 0 ? envMs : defaultTimeoutMs);

  const researchTask = (sourceUrl) => {
    let sourceHost;
    try {
      sourceHost = new URL(sourceUrl).hostname;
    } catch {
      sourceHost = '';
    }
    const sourceArticles = articles.filter(a => a.sourceUrl === sourceUrl || (sourceHost && a.sourceHost === sourceHost));

    return (async () => {
      let rawResult;
      let usage = { available: false };

      if (_mockRun) {
        rawResult = await _mockRun({ sourceUrl, articles: sourceArticles, themes, from, to });
      } else {
        const { Codex } = await import('@openai/codex-sdk');
        const thread = new Codex().startThread(codexThreadOptions());
        const prompt = `You are a careful personal news editor. Use your web tools to research recent news only for the user-approved source URL and its exact hostname. Source: ${sourceUrl}. Themes: ${themes.join(', ') || 'all topics'}. Date window: ${from || 'no lower bound'} through ${to || 'no upper bound'}. You may use the pre-fetched candidates for this source below, but do not stop if they are empty. Return up to 12 real, directly verified article URLs from the approved host only, with their exact titles and publication dates when available. Never invent URLs, titles, or dates.\nPre-fetched articles for this source: ${JSON.stringify(sourceArticles)}`;
        const result = await thread.run(prompt, { outputSchema: codexOutputSchema() });
        rawResult = extractJson(result.finalResponse);
        usage = normalizeCodexUsage(result.usage);
      }

      const normalized = normalizeAgentResult(rawResult, sourceArticles, [sourceUrl]);
      const validCandidates = normalized.candidates;
      const validAutomatic = normalized.automaticDigestUrls;
      const checkedCount = Number.isInteger(rawResult?.checkedCount) && rawResult.checkedCount >= 0 ? rawResult.checkedCount : null;

      let outcome = rawResult?.outcome;
      if (!['researched', 'no_relevant_articles', 'unreachable_from_research', 'blocked', 'unsupported'].includes(outcome)) {
        outcome = validCandidates.length > 0 ? 'researched' : 'no_relevant_articles';
      }

      return {
        sourceUrl,
        candidates: validCandidates,
        automaticDigestUrls: validAutomatic,
        checkedCount,
        foundCount: validCandidates.length,
        outcome,
        error: null,
        usage
      };
    })();
  };

  // Race each per-source task against a shared timer. If the task is still
  // running when the timer fires, we abandon it (the underlying codex
  // child process continues to run; we just stop awaiting it) and return a
  // typed outcome of `unreachable_from_research` with `errorName:
  // CodexResearchTimeout` so the UI and audit log can report a real
  // failure mode instead of a fake progress bar.
  const withTimeout = (sourceUrl, taskPromise) => new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        sourceUrl,
        candidates: [],
        automaticDigestUrls: [],
        checkedCount: null,
        foundCount: 0,
        outcome: 'unreachable_from_research',
        errorName: 'CodexResearchTimeout',
        error: 'Source research timed out',
        usage: { available: false }
      });
    }, timeoutMs);
    // The fulfillment / rejection handlers below also consume late rejections
    // from the abandoned task so they cannot bubble as UnhandledPromiseRejection.
    // By design we do not surface the late failure — the timeout has already
    // produced our typed outcome and we have stopped awaiting the SDK call.
    taskPromise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          sourceUrl,
          candidates: [],
          automaticDigestUrls: [],
          checkedCount: null,
          foundCount: 0,
          outcome: 'unreachable_from_research',
          errorName: err?.name || 'CodexResearchFailed',
          error: 'Source research failed; see server logs for details',
          usage: { available: false }
        });
      }
    );
  });

  const runs = await Promise.allSettled(sourceUrls.map((sourceUrl) => withTimeout(sourceUrl, researchTask(sourceUrl))));

  const researchSources = [];
  const allCandidates = [];
  const allAutomatic = [];
  const usages = [];
  let timedOutSourceCount = 0;

  runs.forEach((res, index) => {
    const sourceUrl = sourceUrls[index];
    if (res.status === 'fulfilled') {
      const data = res.value;
      if (data.errorName === 'CodexResearchTimeout') timedOutSourceCount += 1;
      researchSources.push({
        url: sourceUrl,
        outcome: data.outcome,
        checkedCount: data.checkedCount,
        foundCount: data.foundCount,
        errorName: data.errorName || null,
        error: data.error
      });
      allCandidates.push(...data.candidates);
      allAutomatic.push(...data.automaticDigestUrls);
      usages.push(data.usage);
    } else {
      researchSources.push({
        url: sourceUrl,
        outcome: 'unreachable_from_research',
        checkedCount: null,
        foundCount: 0,
        errorName: res.reason?.name || 'CodexResearchRejected',
        error: 'Source research failed; see server logs for details'
      });
      usages.push({ available: false });
    }
  });

  const uniqueMap = new Map();
  for (const candidate of allCandidates) {
    if (!uniqueMap.has(candidate.url)) {
      uniqueMap.set(candidate.url, candidate);
    }
  }
  const uniqueCandidates = [...uniqueMap.values()];

  const candidateUrls = new Set(uniqueCandidates.map(c => c.url));
  const automaticDigestUrls = [...new Set(allAutomatic)].filter(url => candidateUrls.has(url));

  return {
    candidates: uniqueCandidates,
    automaticDigestUrls,
    researchSources,
    timedOutSourceCount,
    researchTimeoutMs: timeoutMs,
    tokenUsage: aggregateCodexUsage(usages)
  };
}
