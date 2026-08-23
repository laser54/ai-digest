export function formatDigestForClipboard(items) {
  return items.flatMap((item) => {
    const title = typeof item?.title === 'string' ? item.title.trim().replace(/\s+/g, ' ') : '';
    const url = typeof item?.url === 'string' ? item.url : '';
    try {
      if (!title || !url || !['http:', 'https:'].includes(new URL(url).protocol)) return [];
    } catch {
      return [];
    }
    return [{ title, url }];
  }).map(({ title, url }, index) => `${index + 1}. ${title}\n${url}`).join('\n');
}
