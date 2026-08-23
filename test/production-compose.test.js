import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production app uses public DNS and an init process', async () => {
  const compose = await readFile(new URL('../deploy/docker-compose.production.yml', import.meta.url), 'utf8');

  assert.match(compose, /^    dns:\n      - 1\.1\.1\.1\n      - 8\.8\.8\.8$/m);
  assert.match(compose, /^    init: true$/m);
});
