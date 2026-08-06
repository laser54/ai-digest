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

export async function rankArticlesWithCodex({ articles = [], sourceUrls = [], themes = [], from, to, _mockRun }) {
  const runs = await Promise.allSettled(sourceUrls.map(async (sourceUrl) => {
    let sourceHost;
    try {
      sourceHost = new URL(sourceUrl).hostname;
    } catch {
      sourceHost = '';
    }
    const sourceArticles = articles.filter(a => a.sourceUrl === sourceUrl || (sourceHost && a.sourceHost === sourceHost));

    try {
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
      const checkedCount = Number.isInteger(rawResult?.checkedCount) && rawResult.checkedCount >= 0 ? rawResult.checkedCount : validCandidates.length;

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
    } catch (err) {
      return {
        sourceUrl,
        candidates: [],
        automaticDigestUrls: [],
        checkedCount: 0,
        foundCount: 0,
        outcome: 'unreachable_from_research',
        error: err?.message || 'Failed to research source with Codex',
        usage: { available: false }
      };
    }
  }));

  const researchSources = [];
  const allCandidates = [];
  const allAutomatic = [];
  const usages = [];

  runs.forEach((res, index) => {
    const sourceUrl = sourceUrls[index];
    if (res.status === 'fulfilled') {
      const data = res.value;
      researchSources.push({
        url: sourceUrl,
        outcome: data.outcome,
        checkedCount: data.checkedCount,
        foundCount: data.foundCount,
        error: data.error
      });
      allCandidates.push(...data.candidates);
      allAutomatic.push(...data.automaticDigestUrls);
      usages.push(data.usage);
    } else {
      researchSources.push({
        url: sourceUrl,
        outcome: 'unreachable_from_research',
        checkedCount: 0,
        foundCount: 0,
        error: res.reason?.message || 'Failed to research source'
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
    tokenUsage: aggregateCodexUsage(usages)
  };
}
