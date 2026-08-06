import * as cheerio from 'cheerio';
import { validatePublicHttpUrl } from './url-policy.js';

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;

export class FetchSourceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'FetchSourceError';
    this.status = status;
  }
}

export async function fetchHtml(startUrl) {
  let current;
  try {
    current = await validatePublicHttpUrl(startUrl);
  } catch (err) {
    throw new FetchSourceError('blocked', err.message);
  }

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000),
        headers: { 'user-agent': 'AI-Digest/0.1 (+personal research)' }
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout/i.test(err?.message || '')) {
        throw new FetchSourceError('timeout', 'Request timed out');
      }
      throw new FetchSourceError('http_error', err?.message || 'Network fetch failed');
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new FetchSourceError('redirect_error', 'Redirect without a location');
      try {
        const targetUrl = new URL(location, current).href;
        current = await validatePublicHttpUrl(targetUrl);
      } catch (err) {
        throw new FetchSourceError('redirect_error', err.message);
      }
      continue;
    }

    if (!response.ok) {
      throw new FetchSourceError('http_error', `Source returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('text/html')) {
      throw new FetchSourceError('non_html', 'Source did not return HTML');
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
      throw new FetchSourceError('too_large', 'Source response exceeds 1.5 MB');
    }

    let body;
    try {
      body = await response.arrayBuffer();
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout/i.test(err?.message || '')) {
        throw new FetchSourceError('timeout', 'Request timed out');
      }
      throw new FetchSourceError('http_error', 'Failed to read response body');
    }

    if (body.byteLength > MAX_BYTES) {
      throw new FetchSourceError('too_large', 'Source response exceeds 1.5 MB');
    }

    return { url: current.href, html: new TextDecoder().decode(body) };
  }
  throw new FetchSourceError('redirect_error', 'Too many redirects');
}

function dateFrom($node) {
  return $node.find('time').first().attr('datetime') || $node.attr('datetime') || null;
}

export async function fetchArticles(sourceUrls, maxPerSource = 20) {
  const sourceResults = await Promise.allSettled(sourceUrls.map(async (sourceUrl) => {
    try {
      const { url, html } = await fetchHtml(sourceUrl);
      const $ = cheerio.load(html);
      const pageTitle = $('title').first().text().replace(/\s+/g, ' ').trim();
      let sourceHost;
      try {
        sourceHost = new URL(url).hostname;
      } catch {
        sourceHost = new URL(sourceUrl).hostname;
      }
      const links = [];
      const directArticle = $('article').first();
      if (directArticle.length) {
        links.push({
          title: directArticle.find('h1').first().text() || pageTitle,
          url,
          publishedAt: dateFrom(directArticle),
          sourceUrl,
          sourceHost
        });
      }
      $('article a[href], h2 a[href], h3 a[href]').each((_, element) => {
        const anchor = $(element);
        const title = anchor.text().replace(/\s+/g, ' ').trim();
        const href = anchor.attr('href');
        if (!title || !href) return;
        let articleUrl;
        try {
          articleUrl = new URL(href, url).href;
        } catch {
          return;
        }
        if (articleUrl.startsWith('http:') || articleUrl.startsWith('https:')) {
          links.push({
            title,
            url: articleUrl,
            publishedAt: dateFrom(anchor.closest('article')),
            sourceUrl,
            sourceHost
          });
        }
      });

      const status = links.length > 0 ? 'fetched' : 'no_articles';
      return {
        url: sourceUrl,
        status,
        articles: links,
        error: null
      };
    } catch (err) {
      const status = err instanceof FetchSourceError ? err.status : 'http_error';
      return {
        url: sourceUrl,
        status,
        articles: [],
        error: err.message || 'Unknown error'
      };
    }
  }));

  const sources = sourceResults.map((res, index) => {
    if (res.status === 'fulfilled') {
      return res.value;
    }
    const err = res.reason;
    const status = err instanceof FetchSourceError ? err.status : 'http_error';
    return {
      url: sourceUrls[index],
      status,
      articles: [],
      error: err?.message || 'Failed to fetch source'
    };
  });

  const allArticles = sources.flatMap((s) => s.articles);
  const uniqueMap = new Map();
  for (const article of allArticles) {
    if (!uniqueMap.has(article.url)) {
      uniqueMap.set(article.url, article);
    }
  }

  const uniqueArticles = [...uniqueMap.values()].slice(0, sourceUrls.length * maxPerSource);

  return Object.assign(uniqueArticles, {
    articles: uniqueArticles,
    sources
  });
}

