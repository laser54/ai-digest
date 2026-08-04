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
    required: ['candidates', 'automaticDigestUrls'],
    properties: {
      candidates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['url', 'title', 'publishedAt', 'reason'], properties: { url: { type: 'string' }, title: { type: 'string' }, publishedAt: { type: 'string' }, reason: { type: 'string' } } } },
      automaticDigestUrls: { type: 'array', items: { type: 'string' } }
    }
  };
}

export async function rankArticlesWithCodex({ articles, sourceUrls, themes, from, to }) {
  const { Codex } = await import('@openai/codex-sdk');
  const thread = new Codex().startThread(codexThreadOptions());
  const prompt = `You are a careful personal news editor. Use your web tools to research recent news only from the user-approved source URLs and their exact hostnames. Sources: ${JSON.stringify(sourceUrls)}. Themes: ${themes.join(', ') || 'all topics'}. Date window: ${from || 'no lower bound'} through ${to || 'no upper bound'}. You may use the pre-fetched candidates below, but do not stop if they are empty. Return up to 12 real, directly verified article URLs from the approved hosts only, with their exact titles and publication dates when available. Never invent URLs, titles, or dates.\nPre-fetched articles: ${JSON.stringify(articles)}`;
  const result = await thread.run(prompt, { outputSchema: codexOutputSchema() });
  return normalizeAgentResult(extractJson(result.finalResponse), articles, sourceUrls);
}
