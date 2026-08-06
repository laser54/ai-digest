export function formatSourceStatus(status, kind = 'prefetch') {
  switch (status) {
    case 'fetched':
      return 'Успешно загружен';
    case 'no_articles':
      return 'Статей не найдено';
    case 'timeout':
      return 'Таймаут';
    case 'http_error':
      return 'Ошибка HTTP';
    case 'non_html':
      return 'Не-HTML контент';
    case 'redirect_error':
      return 'Ошибка редиректа';
    case 'blocked':
      return kind === 'research' ? 'Заблокирован (AI)' : 'Заблокирован (SSRF)';
    case 'too_large':
      return 'Превышен размер (>1.5 МБ)';
    case 'researched':
      return 'Проверен AI';
    case 'no_relevant_articles':
      return 'Нет подходящих тем';
    case 'unreachable_from_research':
      return 'Недоступен для AI';
    case 'unsupported':
      return 'Не поддерживается';
    default:
      return 'Неизвестный статус';
  }
}

export function buildSourceReportData(sources = [], researchSources = []) {
  const map = new Map();

  for (const src of sources) {
    let hostname = 'invalid-url';
    try {
      hostname = new URL(src.url).hostname;
    } catch {}
    map.set(src.url, {
      url: src.url,
      hostname,
      prefetchStatus: src.status,
      prefetchError: src.error || null,
      candidateCount: (src.articles || []).length,
      researchOutcome: null,
      researchError: null
    });
  }

  for (const rSrc of researchSources) {
    let entry = map.get(rSrc.url);
    if (!entry) {
      let hostname = 'invalid-url';
      try {
        hostname = new URL(rSrc.url).hostname;
      } catch {}
      entry = {
        url: rSrc.url,
        hostname,
        prefetchStatus: null,
        prefetchError: null,
        candidateCount: rSrc.foundCount || 0,
        researchOutcome: rSrc.outcome,
        researchError: rSrc.error || null
      };
      map.set(rSrc.url, entry);
    } else {
      entry.researchOutcome = rSrc.outcome;
      entry.researchError = rSrc.error || null;
      if (typeof rSrc.foundCount === 'number') {
        entry.candidateCount = rSrc.foundCount;
      }
    }
  }

  return [...map.values()];
}

export function sourceReportSummary(sources = [], researchSources = []) {
  const report = buildSourceReportData(sources, researchSources);
  const totalCount = report.length;

  let fetchedCount = 0;
  let failedCount = 0;
  let researchedCount = 0;

  for (const item of report) {
    if (item.prefetchStatus === 'fetched' || item.prefetchStatus === 'no_articles') {
      fetchedCount += 1;
    } else if (item.prefetchStatus) {
      failedCount += 1;
    }

    if (item.researchOutcome === 'researched' || item.researchOutcome === 'no_relevant_articles') {
      researchedCount += 1;
    }
  }

  const message = `Обработано источников: ${totalCount} (успешно: ${fetchedCount}, с ошибкой: ${failedCount}, проверено AI: ${researchedCount}).`;

  return {
    totalCount,
    fetchedCount,
    failedCount,
    researchedCount,
    message
  };
}

export function renderSourceReport(container, sources = [], researchSources = []) {
  if (!container) return;
  const report = buildSourceReportData(sources, researchSources);
  const summary = sourceReportSummary(sources, researchSources);

  container.replaceChildren();

  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'source-summary-badge';
  summaryDiv.textContent = summary.message;
  container.append(summaryDiv);

  if (!report.length) return;

  const list = document.createElement('ul');
  list.className = 'source-report-list';

  for (const item of report) {
    const li = document.createElement('li');
    li.className = `source-item source-${item.prefetchStatus || 'unknown'}`;

    const hostSpan = document.createElement('span');
    hostSpan.className = 'source-host';
    hostSpan.textContent = item.hostname;

    const prefetchBadge = document.createElement('span');
    prefetchBadge.className = `badge status-${item.prefetchStatus || 'unknown'}`;
    prefetchBadge.textContent = `Fetch: ${formatSourceStatus(item.prefetchStatus)}`;

    li.append(hostSpan, prefetchBadge);

    if (item.researchOutcome) {
      const researchBadge = document.createElement('span');
      researchBadge.className = `badge outcome-${item.researchOutcome}`;
      researchBadge.textContent = `AI: ${formatSourceStatus(item.researchOutcome, 'research')}`;
      li.append(researchBadge);
    }

    if (item.prefetchError || item.researchError) {
      const errSpan = document.createElement('span');
      errSpan.className = 'source-error';
      errSpan.textContent = item.prefetchError || item.researchError;
      li.append(errSpan);
    }

    list.append(li);
  }

  container.append(list);
}
