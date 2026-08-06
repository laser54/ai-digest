import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSettings, writeSettings } from '../src/settings-storage.js';
import { app } from '../src/server.js';

test('settings storage defaults to empty arrays when file is missing or invalid', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-digest-test-'));
  const original = process.env.SETTINGS_FILE;
  process.env.SETTINGS_FILE = path.join(dir, 'nonexistent.json');

  try {
    const settings = await readSettings();
    assert.deepEqual(settings, { sources: [], themes: [] });
  } finally {
    process.env.SETTINGS_FILE = original;
    await rm(dir, { recursive: true, force: true });
  }
});

test('settings storage writes and reads normalized settings', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-digest-test-'));
  const original = process.env.SETTINGS_FILE;
  process.env.SETTINGS_FILE = path.join(dir, 'settings.json');

  try {
    const data = {
      sources: [{ url: 'https://example.com/news', enabled: true }],
      themes: ['AI', 'Разработка']
    };

    await writeSettings(data);
    const read = await readSettings();
    assert.deepEqual(read, data);
  } finally {
    process.env.SETTINGS_FILE = original;
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET and PUT /api/settings endpoints retrieve and update configuration', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-digest-test-'));
  const originalSettings = process.env.SETTINGS_FILE;
  const originalAdmin = process.env.ADMIN_PASSWORD;
  process.env.SETTINGS_FILE = path.join(dir, 'settings.json');
  process.env.ADMIN_PASSWORD = 'test-password';

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const getRes = await fetch(`${baseUrl}/api/settings`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.deepEqual(getBody, { sources: [], themes: [] });

    const payload = {
      sources: [{ url: 'https://example.com/rss', enabled: true }],
      themes: ['AI', 'Продукты']
    };

    const putRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.deepEqual(putBody, payload);

    const getUpdated = await fetch(`${baseUrl}/api/settings`);
    const updatedBody = await getUpdated.json();
    assert.deepEqual(updatedBody, payload);

    // Test invalid URL validation
    const invalidRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [{ url: 'not-a-valid-url', enabled: true }] })
    });
    assert.equal(invalidRes.status, 400);
  } finally {
    server.close();
    process.env.SETTINGS_FILE = originalSettings;
    process.env.ADMIN_PASSWORD = originalAdmin;
    await rm(dir, { recursive: true, force: true });
  }
});
