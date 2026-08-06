# AI Digest

Минимальный личный веб-инструмент: добавить ссылки на новостные разделы или конкретные статьи, указать темы и период, получить AI-список кандидатов, вручную отметить итог либо выбрать автоматическую подборку.

## Контур v0

- Один оператор, без аккаунтов и БД: настройки и результат существуют только в текущем браузере.
- `POST /api/digest/prepare` валидирует пользовательские HTTP(S)-источники и запускает явный discovery-контракт: server-side prefetch — необязательный сигнал кандидатов, затем Codex web research только по разрешённым hostname.
- Codex возвращает JSON; сервер нормализует и удаляет дубли, пропуская только ссылки с разрешённых hostname. Ответ также содержит безопасные для UI progress events (`prefetching`, `researching`, `complete`).
- Финальный NDJSON-`result` помимо `articles` и `automaticDigestUrls` содержит `sources` — типизированный отчёт по каждому входному URL, чтобы UI мог показывать честное покрытие, а не «обработано N»:
  - `result.sources` — массив той же длины, что и входной `sourceUrls`, в исходном порядке.
  - каждый элемент: `{ url, status, articles: [...], error: string | null }`.
  - `status` ∈ `fetched`, `no_articles`, `timeout`, `http_error`, `non_html`, `too_large`, `redirect_error`, `blocked`. Один недоступный источник не отменяет исследование остальных.
- Никакие ключи или Codex credentials не передаются в браузер.

## Запуск

```bash
npm install
npm start
# открыть http://127.0.0.1:3030
```

Для работы AI-шага серверу нужна действующая авторизация Codex CLI/SDK в его runtime-пользователе. Не задавайте секреты через браузер и не коммитьте их в репозиторий.

## Production at `ai-digest.larin.work`

Production Compose is `deploy/docker-compose.production.yml`. It attaches only to the external `rag-stack_internal` Docker network and Traefik publishes it; the app port is not exposed on the host.

The public interface and health endpoint are visible, but every AI execution requires a separate shared password entered in the form. Runtime-only host assets are:

- `/etc/ai-digest/ai-digest.env` — `root:root`, mode `0600`; contains `ADMIN_PASSWORD`.
- `/var/lib/ai-digest/codex/` — owned by the container `node` user, mode `0700`; contains private, refreshable Codex `auth.json` state. It is not copied into the image or Git.

The DNS `A`/`AAAA` record must resolve to the Traefik VPS before first deployment so Let's Encrypt can issue a certificate. The container runs as the unprivileged Node user with a read-only root filesystem, small `/tmp`, dropped Linux capabilities and no host port.

## Проверка

```bash
npm test
curl http://127.0.0.1:3030/api/health
```

## Безопасность URL

До каждого запроса и редиректа сервис валидирует HTTP(S)-URL, DNS-резолв и IP-адрес. Закрыты credential-bearing URL, loopback, private, link-local, multicast/reserved ranges, нестандартные порты, длинные ответы и цепочки редиректов. Это минимальный safety baseline, не публичный multi-tenant service.
