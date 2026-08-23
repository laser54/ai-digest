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

export function classifyCodexResearchError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const authenticationRequired = error?.status === 401
    || error?.code === 401
    || /refresh token.*(?:already been used|expired|invalid|revoked)|authentication required|not logged in|reauthenticate/i.test(message);

  return authenticationRequired ? {
    outcome: 'reauthentication_required',
    errorName: 'CodexAuthenticationRequired',
    error: 'Codex authentication expired; operator reauthentication is required'
  } : {
    outcome: 'unreachable_from_research',
    errorName: 'CodexResearchFailed',
    error: 'Source research failed; see server logs for details'
  };
}

export async function rankArticlesWithCodex({ articles = [], sourceUrls = [], themes = [], from, to, _mockRun, _timeoutMs }) {
  const defaultTimeoutMs = 120_000;
  const envMs = Number(process.env.CODEX_RESEARCH_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(_timeoutMs) && _timeoutMs > 0
    ? _timeoutMs
    : (Number.isInteger(envMs) && envMs > 0 ? envMs : defaultTimeoutMs);

  const researchTask = (sourceUrl, signal) => {
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
        rawResult = await _mockRun({ sourceUrl, articles: sourceArticles, themes, from, to, signal });
      } else {
        const { Codex } = await import('@openai/codex-sdk');
        const thread = new Codex().startThread(codexThreadOptions());
        const prompt = `You are a careful personal news editor. Use your web tools to research recent news only for the user-approved source URL and its exact hostname. Source: ${sourceUrl}. Themes: ${themes.join(', ') || 'all topics'}. Date window: ${from || 'no lower bound'} through ${to || 'no upper bound'}. You may use the pre-fetched candidates for this source below, but do not stop if they are empty. Return up to 12 real, directly verified article URLs from the approved host only, with their exact titles and publication dates when available. Never invent URLs, titles, or dates.\nPre-fetched articles for this source: ${JSON.stringify(sourceArticles)}`;
        const result = await thread.run(prompt, { outputSchema: codexOutputSchema(), signal });
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

  const withTimeout = (sourceUrl) => new Promise((resolve) => {
    let settled = false;
    const controller = new AbortController();
    const taskPromise = researchTask(sourceUrl, controller.signal);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
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
    // Consume the abort rejection; settled ensures it cannot replace the timeout.
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
          ...classifyCodexResearchError(err),
          usage: { available: false }
        });
      }
    );
  });

  const runs = new Array(sourceUrls.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < sourceUrls.length) {
      const index = nextIndex++;
      runs[index] = { status: 'fulfilled', value: await withTimeout(sourceUrls[index]) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, sourceUrls.length) }, worker));

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
      const failure = classifyCodexResearchError(res.reason);
      researchSources.push({
        url: sourceUrl,
        outcome: failure.outcome,
        checkedCount: null,
        foundCount: 0,
        errorName: failure.errorName,
        error: failure.error
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
