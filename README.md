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

The active queue remains process-local: terminal job polling expires after 30 minutes and a restart interrupts queued/running work without replaying paid requests. A durable history record is created before paid work starts, updated through queued/running/complete/error, and survives restart on `/codex/digests`; a queued/running record from an earlier process is shown as `interrupted`. History is retained for 180 days and is available through authenticated UI/API after restart. Immutable run settings and research output are separate from editable name, selection, and editorial draft. Edits use revision checks so a stale browser tab receives a visible conflict instead of overwriting newer work.

## Discovery and validation

Discovery has two stages.

### 1. Bounded prefetch

The server fetches each submitted source as an optional candidate signal. Each request is limited to 12 seconds, 1.5 MB, four redirects, standard HTTP(S) ports, and HTML responses. DNS answers and every redirect target are checked against non-public IP ranges; credential-bearing URLs are rejected.

Cheerio performs deliberately simple extraction from article and heading links. Prefetch failures do not prevent Codex research for the same source. The result records a typed status for every input source: `fetched`, `no_articles`, `timeout`, `http_error`, `non_html`, `too_large`, `redirect_error`, or `blocked`.

The prefetched candidates with a publication date are deterministically filtered against the requested inclusive date window. The final merged result is gated again: `YYYY-MM-DD` is a calendar date; an ISO timestamp with an explicit `Z` or numeric timezone offset is converted to its UTC calendar date. Timezone-less ISO timestamps are invalid because their UTC instant is unspecified; invalid or absent dates are labeled as unconfirmed, retained for manual choice, and excluded from automatic selection. Boundaries are inclusive.

### 2. Per-source Codex research

Codex researches every submitted source independently with indexed web search enabled. At most two sources run concurrently. Each source can return up to 12 candidates as structured JSON and has a 120-second total timeout by default.

A second and final attempt is made only when the first structured result is `unreachable_from_research`, `checkedCount` is `0`, and it contains no valid candidates. Other empty, blocked, unsupported, timed-out, or partially checked outcomes are not retried.

The prompt carries the selected themes, date window, and saved `editorialPrompt`. The editorial prompt is an additional filter only: it cannot relax the approved host boundary, date window, directly verified real-URL requirement, or no-invention rules. Article pages and candidates are treated as untrusted research data, so instructions embedded in them must not be followed. All merged prefetch and Codex candidates pass the same strict final date gate; dates outside the inclusive period are removed, while absent/malformed dates remain manual-review-only. A model-reported date is parsed and gated but is still a claim, not source verification.

When the editorial prompt includes an implementation/pilot/production filter (recognized conservatively by configured Russian/English stems such as `внедр`, `пилот`, `эксплуатац`, `запуск`, `интеграц`, `использован`, `implemented`, `deployment`, `pilot`, or `production use`), the pipeline independently fetches candidate pages through the existing SSRF-aware bounded HTML fetcher. It marks a quote verified only when its normalized text is present in extracted article text and the fetched page URL/date match. Announcement evidence is shown as such but is not eligible for automatic selection. If no relevant cue is present, this implementation-specific evidence gate is not imposed. Other prompts remain arbitrary editorial text and should state their intended evidence requirement explicitly.

The Russian textarea in the launch form stores a trimmed value of at most 4000 characters in the existing shared settings JSON and browser localStorage flow. Older settings files without `editorialPrompt` load it as an empty string. An empty value is passed to research as an explicit neutral additional criterion.

### Durable history API and retention

History endpoints use the same execution-password authentication as paid work: `GET /api/digests?limit=20&cursor=...` (or `POST /api/digests/list`), `GET /api/digests/:id` (or `POST /api/digests/:id/read`), `POST /api/digests` for explicit saves, `PATCH /api/digests/:id` with the current `revision`, and `DELETE /api/digests/:id` with the current revision. Retry is `POST /api/digests/:id/retries` with the parent revision, a stable submission ID, and an explicit failed-source subset. A stale revision returns HTTP 409 and never silently overwrites the newer edit. JSON request bodies are limited to 64 KB; an oversized save/edit fails rather than raising this fallback limit.

The production store is one atomic JSON file per digest under `/codex/digests` on the already-mounted `/codex` volume. Records are capped at 2 MB; page size is capped at 50; entries older than 180 days are removed when accessed/listed. The UI shows an empty state and confirms deletion. No password, Codex credential, or `/codex/auth`/settings content is copied into digest records. On restart, queued/running records are returned as `interrupted`; workers are not resumed.

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

The UI exposes typed prefetch and research outcomes for each source and reports counts after final date filtering. One failed source does not erase successful results from the others. For a saved digest, the retry panel lists failed/unreachable source reasons before launch; it allows only an explicitly selected subset, excludes success and `no_relevant_articles`, and merges new normalized URLs without replacing the saved editorial selection. Retry attempts and their individual usage remain in the parent digest history.

Each candidate shows its source hostname, reported date, date/evidence status, and selection reason. In implementation-filtered mode, evidence cards show organization, technology, implementation, stage, excerpt, fetched URL, and date provenance when verified. Failed, listing, blocked, undated, or quote-mismatched fetches are not labeled verified; manual selection remains available. The operator can check links manually or accept the model's constrained automatic subset. Clipboard output is plain text in this form:

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
| `CODEX_DISCOVERY_MODEL` | `gpt-5.6-luna` | Selects the discovery model; only `gpt-5.6-terra` is accepted as an override, and other values fall back to Luna. The default is intentionally unchanged pending a real compatibility check against the deployed Codex SDK; a different CLI/parent runtime accepting another model is not proof that this SDK accepts it. |
| `CODEX_RESEARCH_TIMEOUT_MS` | `120000` | Positive integer total timeout for each source research task. |
| `DIGEST_HISTORY_DIR` | production `/codex/digests` | Optional override for durable file-backed history. In production, keep the default on the existing `/codex` persistent volume; no new database is required. |
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
- The execution password is removed before work is fingerprinted or stored and is not returned in job status or durable history. Reusing a submission ID with different normalized sources, themes, editorial prompt, or dates returns typed HTTP 409 `submission_conflict`; auth is checked first.
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
src/digest-result.js           strict final date gate and model URL normalization
src/digest-history.js          revisioned atomic JSON digest history on persistent storage
src/evidence.js                conservative evidence verification and editorial-filter detection
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
- There is no database, durable worker queue, or account system. Active execution disappears on process restart or deployment; the corresponding pre-created history item remains and reports `interrupted`. It is not resumed or automatically retried. Completed history and editable selection survive restart.
- Queue coordination assumes one Node.js process and one replica. Multiple replicas would break the global one-digest guarantee and process-local deduplication.
- HTML extraction is intentionally simple and does not execute client-side JavaScript or use site-specific parsers.
- Model-reported dates remain unverified claims unless evidence fetching confirms them. Date parsing, inclusive bounds, and final candidate/automatic-selection gating are enforced server-side for both prefetch and model results. Timestamp dates are converted to UTC; plain `YYYY-MM-DD` values remain calendar dates.
- The shared settings file is mutable but non-secret. Its unauthenticated API can be read or changed by anyone who can reach the service.
- Digest history endpoints require the execution password. Per-digest JSON writes are atomic and revision checked; corrupt or oversized records fail closed. The 180-day retention window is the documented history visibility policy. History does not save execution passwords, Codex credentials, or the shared settings file.
- A date in a timestamp with an explicit timezone is interpreted by its UTC date, not the source's local timezone. Timezone-less ISO timestamps are invalid and require manual review; the application does not guess UTC or the source timezone. Reported model dates remain claims until independently fetched.
- Evidence-card classification is conservative. `fetched_verified` is reserved for pipeline-verified page text/excerpt/date; a model assertion alone is never enough. A fetched announcement can be verified as an announcement but is not automatically selected for an implementation filter. Unverified items remain manually selectable. Evidence fetching uses the same bounded SSRF-aware HTML policy; evidence fetching is not a paid model call. Quote matching normalizes Unicode to NFKC, collapses whitespace, trims, and compares case-insensitively; this supports layout whitespace differences, not paraphrases.
- Retry is manual and source-scoped. Only sources whose terminal research outcome is `unreachable_from_research` are eligible; successful and `no_relevant_articles` outcomes are excluded. Each retry records its own usage and status and never aggregates that usage into the original run's usage.
- The execution password does not make the application multi-tenant and does not protect the public UI or settings API.
- No license file is included. The repository should not be described as open source or MIT-licensed.
