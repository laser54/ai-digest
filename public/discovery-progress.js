function plural(count, one, few, many) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

export function discoveryProgressMessage(event) {
  switch (event.phase) {
    case 'queued':
      return 'Запрос поставлен в очередь…';
    case 'prefetching':
      return `Обрабатываем ${event.sourceCount} ${plural(event.sourceCount, 'источник', 'источника', 'источников')}…`;
    case 'prefetched':
      return `Обработано ${event.sourceCount} ${plural(event.sourceCount, 'источник', 'источника', 'источников')} · найдено ${event.candidateLinkCount} ${plural(event.candidateLinkCount, 'ссылка-кандидат', 'ссылки-кандидата', 'ссылок-кандидатов')}.`;
    case 'researching':
      return `AI проверяет ${event.sourceCount} ${plural(event.sourceCount, 'источник', 'источника', 'источников')} и ${event.candidateLinkCount} ${plural(event.candidateLinkCount, 'ссылку-кандидат', 'ссылки-кандидата', 'ссылок-кандидатов')}. Процент готовности недоступен.`;
    case 'complete':
      return `Готово: ${event.candidateCount} ${plural(event.candidateCount, 'кандидат', 'кандидата', 'кандидатов')}.`;
    default:
      return 'AI готовит дайджест…';
  }
}
