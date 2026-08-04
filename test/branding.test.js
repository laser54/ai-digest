import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';


test('serves the AI Digest title and branded favicon from the public directory', async () => {
  const [index, favicon, dockerfile] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8'),
    readFile(new URL('../Dockerfile', import.meta.url), 'utf8')
  ]);

  assert.match(index, /<title>AI Digest<\/title>/);
  assert.match(index, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/);
  assert.match(favicon, /<title>Digest<\/title>/);
  assert.match(dockerfile, /COPY public \.\/public/);
});
