import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createDigestHistory } from '../src/digest-history.js';

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const request = (base, route, method, body, password = 'local-secret') => fetch(`${base}${route}`, {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, executionPassword: password })
});

test('history endpoints authenticate, persist snapshots, and return revision conflicts without overwrites', async () => {
  const directory = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'digest-history-api-'));
  const history = createDigestHistory(directory);
  const app = createApp({ password: 'local-secret', jobs: { submit() {}, status() { return null; } }, history });
  const payload = {
    snapshot: { sourceUrls: ['https://example.com/news'], themes: ['AI'], editorialPrompt: 'pilot', from: '', to: '' },
    result: { articles: [{ url: 'https://example.com/a', title: 'A' }], automaticDigestUrls: [] }, selectedUrls: [], editorialDraft: ''
  };
  try {
    await withServer(app, async (base) => {
      assert.equal((await request(base, '/api/digests/list', 'POST', { limit: 10 }, 'wrong')).status, 401);
      const createdResponse = await request(base, '/api/digests', 'POST', payload);
      assert.equal(createdResponse.status, 201);
      const created = await createdResponse.json();
      const patch = { revision: created.revision, name: 'Edited', selectedUrls: ['https://example.com/a'] };
      assert.equal((await request(base, `/api/digests/${created.id}`, 'PATCH', patch)).status, 200);
      const conflict = await request(base, `/api/digests/${created.id}`, 'PATCH', patch);
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).code, 'history_revision_conflict');
      const read = await request(base, `/api/digests/${created.id}/read`, 'POST', {});
      assert.equal((await read.json()).name, 'Edited');
      const page = await request(base, '/api/digests/list', 'POST', { limit: 10 });
      assert.equal((await page.json()).items[0].id, created.id);
    });
    const restarted = createDigestHistory(directory);
    assert.equal((await restarted.list()).items[0].snapshot.editorialPrompt, 'pilot');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
