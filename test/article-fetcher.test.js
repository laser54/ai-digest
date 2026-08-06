import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchArticles, fetchHtml, FetchSourceError } from '../src/article-fetcher.js';

test('blocks non-public IP and invalid URLs with blocked status', async () => {
  const result = await fetchArticles(['http://127.0.0.1/admin', 'http://169.254.169.254/latest']);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].status, 'blocked');
  assert.equal(result.sources[1].status, 'blocked');
  assert.equal(result.articles.length, 0);
});

test('handles partial success when one source fails and another succeeds', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/good')) {
      return new Response(`
        <!text/html>
        <html>
          <head><title>Good Source</title></head>
          <body>
            <article>
              <h1>Good Main Article</h1>
              <a href="/good-post-1">Good Post 1</a>
            </article>
          </body>
        </html>
      `, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (urlStr.includes('/bad')) {
      return new Response('Server error', { status: 500, headers: { 'content-type': 'text/html' } });
    }
    return originalFetch(url);
  };

  try {
    const result = await fetchArticles(['https://example.com/good', 'https://example.com/bad']);
    assert.equal(result.sources.length, 2);
    assert.equal(result.sources[0].status, 'fetched');
    assert.equal(result.sources[0].articles.length, 2);
    assert.equal(result.sources[1].status, 'http_error');
    assert.equal(result.sources[1].articles.length, 0);
    assert.equal(result.articles.length, 2);
    assert.equal(result.articles[0].url, 'https://example.com/good');
    assert.equal(result.articles[1].url, 'https://example.com/good-post-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports http_error status for non-2xx response status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  try {
    const result = await fetchArticles(['https://example.com/notfound']);
    assert.equal(result.sources[0].status, 'http_error');
    assert.match(result.sources[0].error, /HTTP 404/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports non_html status when response Content-Type is not text/html', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const result = await fetchArticles(['https://example.com/api']);
    assert.equal(result.sources[0].status, 'non_html');
    assert.match(result.sources[0].error, /did not return HTML/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports timeout status when request times out', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    throw err;
  };

  try {
    const result = await fetchArticles(['https://example.com/slow']);
    assert.equal(result.sources[0].status, 'timeout');
    assert.match(result.sources[0].error, /timed out/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports too_large status when body exceeds max bytes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('x'.repeat(2_000_000), {
    status: 200,
    headers: { 'content-type': 'text/html', 'content-length': '2000000' }
  });

  try {
    const result = await fetchArticles(['https://example.com/huge']);
    assert.equal(result.sources[0].status, 'too_large');
    assert.match(result.sources[0].error, /exceeds 1\.5 MB/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports redirect_error status for redirect loops or redirecting to private IP', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/loop')) {
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    }
    return originalFetch(url);
  };

  try {
    const result = await fetchArticles(['https://example.com/loop']);
    assert.equal(result.sources[0].status, 'redirect_error');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports no_articles status when HTML page has no article links', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><body><p>Plain text page without articles</p></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' }
  });

  try {
    const result = await fetchArticles(['https://example.com/empty']);
    assert.equal(result.sources[0].status, 'no_articles');
    assert.equal(result.sources[0].articles.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('deduplicates articles across sources while preserving source metadata association', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/source-a')) {
      return new Response(`
        <html><body>
          <h2><a href="https://example.com/shared-article">Shared Article Title</a></h2>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (urlStr.includes('/source-b')) {
      return new Response(`
        <html><body>
          <h2><a href="https://example.com/shared-article">Shared Article Title Duplicate</a></h2>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return originalFetch(url);
  };

  try {
    const result = await fetchArticles(['https://example.com/source-a', 'https://example.com/source-b']);
    assert.equal(result.sources.length, 2);
    assert.equal(result.articles.length, 1);
    assert.equal(result.articles[0].url, 'https://example.com/shared-article');
    assert.equal(result.articles[0].sourceUrl, 'https://example.com/source-a');
    assert.equal(result.articles[0].sourceHost, 'example.com');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
