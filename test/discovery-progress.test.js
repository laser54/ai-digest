import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryProgressMessage } from '../public/discovery-progress.js';

test('describes determinate source and candidate-link counts without inventing a Codex percentage', () => {
  assert.equal(
    discoveryProgressMessage({ phase: 'prefetching', sourceCount: 2 }),
    'Обрабатываем 2 источника…'
  );
  assert.equal(
    discoveryProgressMessage({ phase: 'prefetched', sourceCount: 2, candidateLinkCount: 5 }),
    'Обработано 2 источника · найдено 5 ссылок-кандидатов.'
  );
  assert.equal(
    discoveryProgressMessage({ phase: 'prefetching', sourceCount: 6 }),
    'Обрабатываем 6 источников…'
  );
  assert.equal(
    discoveryProgressMessage({ phase: 'researching', sourceCount: 2, candidateLinkCount: 5 }),
    'AI проверяет 2 источника и 5 ссылок-кандидатов. Процент готовности недоступен.'
  );
  assert.equal(
    discoveryProgressMessage({ phase: 'complete', sourceCount: 2, candidateCount: 3 }),
    'Готово: 3 кандидата.'
  );
});

test('uses neutral accessible wording for an unknown progress event', () => {
  assert.equal(discoveryProgressMessage({ phase: 'other' }), 'AI готовит дайджест…');
});
