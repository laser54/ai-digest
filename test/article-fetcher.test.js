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

test('returns a pure object result with articles and sources (no array augmentation)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    '<html><head><title>OK</title></head><body><article><h1>One</h1><a href="/x">x</a></article></body></html>',
    { headers: { 'content-type': 'text/html' } }
  );

  try {
    const result = await fetchArticles(['https://example.com/']);
    assert.equal(Array.isArray(result), false, 'result must be a plain object, not an array');
    assert.equal(typeof result, 'object');
    assert.ok(Array.isArray(result.articles));
    assert.ok(Array.isArray(result.sources));
    assert.deepEqual(Object.keys(result).sort(), ['articles', 'sources']);
    assert.equal(result.articles.length, 2);
    assert.equal(result.sources.length, 1);
    const serialized = JSON.stringify(result);
    assert.match(serialized, /"articles":/);
    assert.match(serialized, /"sources":/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not classify errors with "timeout" only in the message as timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const err = new Error('upstream connect timeout (not actually a fetch timeout)');
    throw err;
  };

  try {
    const result = await fetchArticles(['https://example.com/x']);
    assert.equal(result.sources[0].status, 'http_error');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('classifies AbortError and TimeoutError by name as timeout', async () => {
  const originalFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  try {
    observed = (await fetchArticles(['https://example.com/a'])).sources[0].status;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(observed, 'timeout');

  globalThis.fetch = async () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    throw err;
  };
  try {
    observed = (await fetchArticles(['https://example.com/b'])).sources[0].status;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(observed, 'timeout');
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
    assert.equal(result.sources[0].error, 'http_error');
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
    assert.equal(result.sources[0].error, 'non_html');
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
    assert.equal(result.sources[0].error, 'timeout');
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
    assert.equal(result.sources[0].error, 'too_large');
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
