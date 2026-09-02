# AI Digest

AI Digest is a personal news-research workspace for turning a small set of approved sources into a reviewable digest. It exists to reduce the repetitive work of checking source pages, searching each publication, and formatting a short list of links without pretending that model-assisted web research is deterministic.

**Live app:** [ai-digest.larin.work](https://ai-digest.larin.work/)

**Health:** [ai-digest.larin.work/api/health](https://ai-digest.larin.work/api/health)

The interface and health endpoint are public. Starting or polling Codex-backed work requires a shared execution password. This is a single-operator tool: it has no user accounts, tenant isolation, or claim of broader adoption.

## The problem

A useful news digest needs more than a generic search prompt. Sources must remain inside an operator-approved boundary, partial failures must be visible, and the final choice should stay reviewable. Direct HTML extraction alone misses sites that block requests or render poorly; model search alone can return malformed, duplicated, or off-domain URLs.

AI Digest combines a bounded server-side prefetch with per-source Codex indexed web research. The server treats both as fallible inputs, validates model output, and lets the operator choose the final links manually or use the model's automatic subset.

## What I built

- A source and theme workspace with a persistent operator-provided editorial criterion and an optional inclusive date window.
- An in-memory background job API so long research runs survive short browser request failures.
- Explicit submission idempotency, active identical-input deduplication, and a global FIFO queue that runs one digest at a time.
- SSRF-aware HTML prefetch with typed per-source outcomes instead of a misleading all-or-nothing success state.
- Structured, per-source Codex research with bounded concurrency, timeouts, and one narrowly defined recovery attempt.
- Server-side URL normalization, source-boundary enforcement, deduplication, and automatic-selection validation.
- A review UI with manual and automatic selection, source hostname attribution, clipboard output, and token usage when the SDK returns every expected dimension.
- A hardened container deployment and test-before-publish-before-deploy GitHub Actions workflow.

The application uses Node.js 22, Express 5, vanilla JavaScript and CSS, Cheerio, Zod, and `@openai/codex-sdk`. Codex discovery uses `gpt-5.6-luna` by default; the only accepted model override is `gpt-5.6-terra`.

## Workflow

```text
Browser
  │ submit sources, themes, editorial criterion, dates, password, submission ID
  ▼
Express job API ──▶ in-memory FIFO queue (one digest globally)
  ▲                         │
  │ short authenticated     ▼
  │ status polls       bounded HTML prefetch
  │                         │ optional candidate signal
  │                         ▼
  │                  per-source Codex research
  │                  (two sources concurrently)
  │                         │ structured JSON
  │                         ▼
  └──────────── validated candidates and source reports
                            │
                            ▼
                 manual or automatic final digest
```

The browser creates a submission ID, starts a job, and polls the authenticated status endpoint with short requests. Start requests retry with the same ID, so a lost response reuses the original job. A different submission ID starts fresh work after completion, while identical input submitted during an active run shares that active job.

Jobs and results live only in the Node.js process. Terminal results expire after 30 minutes, at most 100 jobs are retained, and unexpired results are not evicted to admit new work. A restart or deployment removes every queued, running, and completed job.

## Discovery and validation

Discovery has two stages.

### 1. Bounded prefetch

The server fetches each submitted source as an optional candidate signal. Each request is limited to 12 seconds, 1.5 MB, four redirects, standard HTTP(S) ports, and HTML responses. DNS answers and every redirect target are checked against non-public IP ranges; credential-bearing URLs are rejected.

Cheerio performs deliberately simple extraction from article and heading links. Prefetch failures do not prevent Codex research for the same source. The result records a typed status for every input source: `fetched`, `no_articles`, `timeout`, `http_error`, `non_html`, `too_large`, `redirect_error`, or `blocked`.

Prefetched candidates with a publication date are deterministically filtered against the requested inclusive date window. Undated candidates remain available.

### 2. Per-source Codex research

Codex researches every submitted source independently with indexed web search enabled. At most two sources run concurrently. Each source can return up to 12 candidates as structured JSON and has a 120-second total timeout by default.

A second and final attempt is made only when the first structured result is `unreachable_from_research`, `checkedCount` is `0`, and it contains no valid candidates. Other empty, blocked, unsupported, timed-out, or partially checked outcomes are not retried.

The prompt carries the selected themes, date window, and saved `editorialPrompt`. The editorial prompt is an additional filter only: it cannot relax the approved host boundary, date window, directly verified real-URL requirement, or no-invention rules. Article pages and candidates are treated as untrusted research data, so instructions embedded in them must not be followed. Unlike dated prefetch results, Codex-discovered dates are not independently re-fetched and server-side post-filtered. Their date compliance relies on the research prompt and structured model output, which is an explicit trust boundary.

The Russian textarea in the launch form stores a trimmed value of at most 4000 characters in the existing shared settings JSON and browser localStorage flow. Older settings files without `editorialPrompt` load it as an empty string. An empty value is passed to research as an explicit neutral additional criterion.

Example criterion (edit it to suit the digest; it is not hardcoded):

```text
Ищи только новости, где описывается фактическое внедрение, запуск, пилотирование, интеграция или использование конкретной технологии либо инновации в российской компании.

В статье должны быть явно указаны:
1. российская компания;
2. конкретная технология, технологический продукт или инновационный процесс;
3. факт практического внедрения, запуска, пилота, интеграции, перехода в эксплуатацию или использования.

Не включай планы и намерения без факта внедрения, общие статьи о трендах, инвестиции без технологического результата и материалы без достаточного подтверждения.
```

### Approved URL boundary

For model-discovered candidates, the approved boundary is HTTPS with no embedded credentials and exactly the submitted hostname's canonical apex/leading-`www` pair. For example, approving `www.example.com` permits `www.example.com` and `example.com`, but rejects `media.example.com` and every unrelated host.

The server parses, validates, and deduplicates model-returned URLs. Automatic selections are then restricted to URLs already present in that validated candidate set. This reduces off-domain output; it does not independently prove that every page exists or that its title and date are correct.

## Review output

The UI exposes typed prefetch and research outcomes for each source and reports how many candidates were found. One failed source does not erase successful results from the others.

Each candidate shows its source hostname, reported date, and selection reason. The operator can check links manually or accept the model's validated automatic subset. Clipboard output is plain text in this form:

```text
1. Article title
https://example.com/article
```

Token usage is shown only when the SDK supplies complete non-negative values for input, cached input, cache-write input, output, and reasoning-output tokens across all source attempts. Otherwise the UI reports usage as unavailable rather than presenting a partial total.

## Quickstart

Requires Node.js 22 or newer and a valid Codex login available to the runtime user.

```bash
npm ci
npm test
ADMIN_PASSWORD='choose-a-local-password' npm start
```

Open [http://127.0.0.1:3030](http://127.0.0.1:3030), enter the same password in the execution form, and check health separately:

```bash
curl http://127.0.0.1:3030/api/health
```

Codex authentication is required for research. Keep its refreshable authentication state outside the repository and do not send it through the browser.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | none | Shared password required by digest start/status endpoints; mandatory at startup and explicitly required in production. |
| `PORT` | `3030` | HTTP listen port. |
| `CODEX_DISCOVERY_MODEL` | `gpt-5.6-luna` | Selects the discovery model; only `gpt-5.6-terra` is accepted as an override, and other values fall back to Luna. |
| `CODEX_RESEARCH_TIMEOUT_MS` | `120000` | Positive integer total timeout for each source research task. |
| `SETTINGS_FILE` | unset | Exact path for the shared non-secret settings JSON file. |
| `CODEX_HOME` / `HOME` | runtime-dependent | Settings storage falls back to `CODEX_HOME/settings.json`, then `HOME/settings.json`; the production mount also supplies Codex authentication under `/codex`. |

## Production deployment

Production runs behind Traefik with no host port. The Compose service joins the existing `rag-stack_internal` network, and Traefik terminates TLS and routes `ai-digest.larin.work` to port 3030 inside the container.

GitHub Actions enforces this sequence on `main`:

```text
npm ci + tests + Docker build
              │
              ▼
publish GHCR image tagged with the full commit SHA (and latest)
              │
              ▼
restricted SSH command: deploy <full SHA>
              │
              ▼
pull and recreate the exact SHA-tagged image
              │
              ▼
container health check + public HTTPS health check
```

The deploy key is intended for a forced command. The server-side script accepts only `deploy <40-character lowercase SHA>`, performs a fast-forward-only source update, verifies that checkout against the requested revision, and deploys without building on the host. The GHCR image selected for deployment is therefore immutable by commit tag even though a convenience `latest` tag is also published.

The production container runs as the unprivileged `node` user with a read-only root filesystem, a size-limited `/tmp` tmpfs, `no-new-privileges`, all Linux capabilities dropped, a PID limit, an init reaper, explicit public DNS resolvers, and no host port mapping.

### Runtime-only assets

Production secrets and mutable Codex state are neither committed nor copied into the image:

- `/etc/ai-digest/ai-digest.env` — root-owned mode `0600`; contains `ADMIN_PASSWORD` and runtime configuration.
- `/var/lib/ai-digest/codex` — mode `0700`, owned for the container's Node user; mounted at `/codex` for Codex authentication and shared settings.

Codex authentication must already be valid in that runtime directory. It is refreshable credential state and should be backed up, rotated, and exposed only according to the operator's own host policy.

## Security boundaries

- The public page and `/api/health` require no authentication. Paid job submission and status polling require the shared execution password.
- The execution password is removed before work is fingerprinted or stored and is not returned in job status.
- Password protection is an execution-cost gate, not user identity, authorization roles, or tenant isolation.
- Source validation blocks credentials, nonstandard ports, and DNS results in loopback, private, link-local, multicast, and reserved IPv4 ranges, plus the covered non-public IPv6 ranges.
- Codex runs with network and indexed web search enabled but a read-only sandbox, no approvals, and no Git checkout requirement.
- Settings contain source URLs, themes, and the editorial prompt, not secrets. The settings API is public and is not an authentication boundary.

If this service is exposed to untrusted users, place a real outer access layer in front of the whole application. The current shared-password and public-settings design is for one trusted operator, not a public multi-user service.

## Project layout

```text
public/                         browser UI and presentation modules
src/server.js                  Express routes and request validation
src/digest-jobs.js             process-local idempotency, queue, and TTL
src/article-fetcher.js         bounded HTML prefetch and extraction
src/url-policy.js              DNS/IP and source URL checks
src/digest-agent.js            Codex prompt, schema, concurrency, timeout
src/digest-result.js           date filtering and model URL normalization
src/settings-storage.js        shared non-secret JSON settings
test/                           Node test-runner coverage
.github/workflows/deploy.yml    test, publish, and deploy pipeline
Dockerfile                     Node 22 production image
deploy/                         production Compose and restricted deploy script
```

## Verification

The repository uses Node's built-in test runner. The suite covers URL policy, authentication, request-body credential handling, job idempotency/deduplication/FIFO/TTL, prefetch limits and status reporting, Codex schemas and recovery rules, research timeouts and partial failure, output normalization, browser polling and rendering helpers, settings, audit logging, and production Compose invariants.

```bash
npm test
docker build -t ai-digest:local .
curl --fail http://127.0.0.1:3030/api/health
```

The GitHub Actions pipeline runs the tests and a Docker build before an image can be published or deployed. Production deployment additionally waits for container health and verifies the public health URL.

## Limitations

- External sites and indexed search are nondeterministic. Sources may block requests, change markup, disappear, or return incomplete metadata.
- There is no database, durable queue, durable job result, or account system. Jobs disappear on process restart or deployment.
- Queue coordination assumes one Node.js process and one replica. Multiple replicas would break the global one-digest guarantee and process-local deduplication.
- HTML extraction is intentionally simple and does not execute client-side JavaScript or use site-specific parsers.
- Prefetched dated links are server-filtered, but model-discovered publication dates rely on prompt compliance and structured output rather than independent retrieval and post-filtering.
- The shared settings file is mutable but non-secret. Its unauthenticated API can be read or changed by anyone who can reach the service.
- The execution password does not make the application multi-tenant and does not protect the public UI or settings API.
- No license file is included. The repository should not be described as open source or MIT-licensed.
