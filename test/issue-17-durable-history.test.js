import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDigestHistory } from '../src/digest-history.js';

test('durable digest history survives store recreation and enforces revisions', async () => {
  const directory = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'digest-history-'));
  try {
    const firstStore = createDigestHistory(directory);
    const snapshot = { sourceUrls: ['https://example.com/news'], themes: ['AI'], editorialPrompt: 'pilot', from: '2026-01-01', to: '2026-01-31' };
    const created = await firstStore.create({ snapshot, result: { articles: [{ url: 'https://example.com/a' }] }, selectedUrls: [], editorialDraft: '' });
    const selected = await firstStore.update(created.id, { selectedUrls: ['https://example.com/a'], editorialDraft: 'Draft' }, created.revision);
    assert.equal(selected.revision, 2);
    await assert.rejects(firstStore.update(created.id, { name: 'stale' }, created.revision), { code: 'history_revision_conflict' });
    const restartedStore = createDigestHistory(directory);
    const restored = await restartedStore.get(created.id);
    assert.deepEqual(restored.snapshot, snapshot);
    assert.deepEqual(restored.selectedUrls, ['https://example.com/a']);
    assert.equal(restored.editorialDraft, 'Draft');
    assert.equal((await restartedStore.list({ limit: 1 })).items[0].id, created.id);
    assert.equal(await restartedStore.remove(created.id, restored.revision), true);
    assert.equal(await restartedStore.get(created.id), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
