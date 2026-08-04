export function tokenUsageMessage(tokenUsage) {
  if (!tokenUsage?.available) return 'Использование токенов Codex недоступно для этого запуска.';
  return `Токены Codex: вход ${tokenUsage.inputTokens} · кэшировано ${tokenUsage.cachedInputTokens} · запись в кэш ${tokenUsage.cacheWriteInputTokens} · выход ${tokenUsage.outputTokens} · рассуждение ${tokenUsage.reasoningOutputTokens}.`;
}
