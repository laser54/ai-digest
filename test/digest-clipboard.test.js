import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDigestForClipboard } from '../public/digest-clipboard.js';

test('formats three valid digest items as exact plain text without blank lines or Markdown', () => {
  const text = formatDigestForClipboard([
    { title: '  Первый\nзаголовок ', url: 'https://example.com/a?x=1&y=2' },
    { title: 'Второй\t заголовок', url: 'https://example.com/b' },
    { title: 'Третий', url: 'https://example.com/c' },
    { title: '', url: 'https://example.com/missing-title' },
    { title: 'Missing URL' }
  ]);

  assert.equal(text, '1. Первый заголовок\nhttps://example.com/a?x=1&y=2\n2. Второй заголовок\nhttps://example.com/b\n3. Третий\nhttps://example.com/c');
  assert.doesNotMatch(text, /\[[^\]]*\]\(|^- /m);
});
