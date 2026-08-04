import { normalizeAgentResult } from './digest-result.js';

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Codex did not return JSON');
  return JSON.parse(match[0]);
}

export function codexThreadOptions() {
  return {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    sandboxMode: 'read-only',
    networkAccessEnabled: false,
    webSearchEnabled: false
  };
}

export async function rankArticlesWithCodex({ articles, themes, from, to }) {
  const { Codex } = await import('@openai/codex-sdk');
  const thread = new Codex().startThread(codexThreadOptions());
  const prompt = `You are a careful personal news editor. Select articles only from the supplied JSON array.\nThemes: ${themes.join(', ') || 'all topics'}.\nDate window: ${from || 'no lower bound'} through ${to || 'no upper bound'}.\nSelect up to 12 candidates and up to 7 automaticDigestUrls. Never invent URLs or titles.\nArticles: ${JSON.stringify(articles)}`;
  const result = await thread.run(prompt, { outputSchema: {
    type: 'object', additionalProperties: false,
    required: ['candidates', 'automaticDigestUrls'],
    properties: {
      candidates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['url', 'reason'], properties: { url: { type: 'string' }, reason: { type: 'string' } } } },
      automaticDigestUrls: { type: 'array', items: { type: 'string' } }
    }
  } });
  return normalizeAgentResult(extractJson(result.finalResponse), articles);
}
