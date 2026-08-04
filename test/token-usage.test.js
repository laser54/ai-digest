import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenUsageMessage } from '../public/token-usage.js';

test('renders documented Codex token dimensions and a clear unavailable state', () => {
  assert.equal(tokenUsageMessage({
    available: true,
    inputTokens: 12,
    cachedInputTokens: 3,
    cacheWriteInputTokens: 2,
    outputTokens: 5,
    reasoningOutputTokens: 7
  }), 'Токены Codex: вход 12 · кэшировано 3 · запись в кэш 2 · выход 5 · рассуждение 7.');
  assert.equal(tokenUsageMessage({ available: false }), 'Использование токенов Codex недоступно для этого запуска.');
});