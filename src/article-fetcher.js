import * as cheerio from 'cheerio';
import { validatePublicHttpUrl } from './url-policy.js';

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;

async function fetchHtml(startUrl) {
  let current = await validatePublicHttpUrl(startUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
      headers: { 'user-agent': 'AI-Digest/0.1 (+personal research)' }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without a location');
      current = await validatePublicHttpUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    if (!response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('Source did not return HTML');
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_BYTES) throw new Error('Source response exceeds 1.5 MB');
    return { url: current.href, html: new TextDecoder().decode(body) };
  }
  throw new Error('Too many redirects');
}

function dateFrom($node) {
  return $node.find('time').first().attr('datetime') || $node.attr('datetime') || null;
}

export async function fetchArticles(sourceUrls, maxPerSource = 20) {
  const results = await Promise.all(sourceUrls.map(async (sourceUrl) => {
    const { url, html } = await fetchHtml(sourceUrl);
    const $ = cheerio.load(html);
    const pageTitle = $('title').first().text().replace(/\s+/g, ' ').trim();
    const links = [];
    const directArticle = $('article').first();
    if (directArticle.length) {
      links.push({ title: directArticle.find('h1').first().text() || pageTitle, url, publishedAt: dateFrom(directArticle) });
    }
    $('article a[href], h2 a[href], h3 a[href]').each((_, element) => {
      const anchor = $(element);
      const title = anchor.text().replace(/\s+/g, ' ').trim();
      const href = anchor.attr('href');
      if (!title || !href) return;
      const articleUrl = new URL(href, url).href;
      if (articleUrl.startsWith('http:') || articleUrl.startsWith('https:')) {
        links.push({ title, url: articleUrl, publishedAt: dateFrom(anchor.closest('article')) });
      }
    });
    return links;
  }));
  const unique = new Map();
  for (const article of results.flat()) if (!unique.has(article.url)) unique.set(article.url, article);
  return [...unique.values()].slice(0, sourceUrls.length * maxPerSource);
}
