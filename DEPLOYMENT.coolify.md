# AI Digest on Coolify

Existing production migration, one replica; no invented DEV.
Resource `AI Digest PROD`, `csfb4gpyqudfgjekt0ebwwij`, target `38.45.65.134`.
GitHub App source `laser54/ai-digest/main`, raw Compose `/docker-compose.coolify.yml`.

## Runtime contract

Native Docker build, no legacy SSH deploy or GHCR image-tag indirection. CI tests and builds only. Keep non-root node, read-only root, init, no-new-privileges, dropped capabilities, pids_limit and tmpfs. Only /codex is persistent; actual volume must be discovered from container mounts. Runtime-only ADMIN_PASSWORD comes from `AI_DIGEST_PROD_ADMIN_PASSWORD` in Bitwarden through Coolify; no build argument secrets.

## Completed production cutover — 2026-10-02

Both runtimes stopped before final snapshot; no Codex child was active on source. Restored final /codex manifest (313 files), SQLite integrity verified, auth/settings preserved. Only A record `ai-digest.larin.work` id `571022547` changed `107.174.26.138` → `38.45.65.134`, TTL 600. Provider readback and all 4 authoritative nameservers confirmed; unrelated DNS unchanged. ACME enabled afterward; trusted forced-new and normal public HTTPS health passed.

One real job `job_5p0hjO8GFO6hbyIucBOYI9uFnFhDd1X7` ran against the first enabled saved source (ALROSA), preserved themes/editorial criterion and a 30-day window. Terminal status **complete**, research **researched**, checkedCount=1, foundCount=1, articles=1. SDK usage available: input=138871, cached=91136, output=1213, reasoning=405. No orphan Codex process remained. This is runtime evidence, not a claim of comprehensive coverage or independently verified accuracy of the returned article.

Final backup and smoke result retained privately under `/root/.hermes/profiles/boss/backups/ai-digest-final-20261002/`; matching snapshot archive is retained on old host `/root/migration-backups/ai-digest-final-20261002/`. Old app remains stopped; old data not deleted. After destination OAuth refresh, rollback must transfer newest auth/settings before source restart. In-memory pre-cutover jobs/results cannot be retained.

Preparation checks below are historical; trusted TLS and real generation are now accepted as above.

## Preparation acceptance

New resource is running:healthy. Native build and restore exercised: all 313 snapshot file hashes matched and SQLite integrity passed. /codex write probe as non-root passed and was removed. Settings API matched restored settings; status endpoint rejected absent execution password (401) and accepted the preserved password (404 for absent job). This does not prove real Codex generation.

Pre-cutover frontend/health routing passed with forced new IP and insecure TLS only; trusted production TLS is NOT accepted yet. ADMIN_PASSWORD actual container equals Coolify/BWS. Runtime read-only/non-root/init/cap-drop/no-new-privileges/pids-limit/no-host-ports verified.

Only qs and undici lock entries updated for existing advisories; npm audit reports 0 vulnerabilities, SDK unchanged.

Local suite: 125 tests passed. Existing auth/settings and Codex service state snapshot captured: SQLite backup API merges live WAL safely, integrity checked; non-SQLite files copied, auth/settings hashes checked before/after. Transient /codex/tmp excluded. Auth/session archives are sensitive; keep backups private, never Git or browser bundles.

Preparation snapshot is not the final cutover snapshot. No app jobs/results DB: in-memory queues/results disappear on restart. New settings/auth must be refreshed after separately approved old stop.

## OAuth ownership fence

Never run copied Codex OAuth credentials concurrently on both hosts: refresh-token rotation can invalidate one copy. Pre-cutover verification covers routing, settings equality, execution auth rejection/acceptance, runtime isolation and local tests; REAL Codex generation is deferred until the old runtime is stopped and the newest auth is copied. Do not substitute mocked generation results for runtime evidence.

## Cutover (separate approval)

Gate destination execution, inspect old active Codex processes/jobs and agree handling of in-memory work; stop old app only, preserve old data. Obtain final frozen /codex snapshot, verify backup/restore, then change only ai-digest.larin.work DNS. Verify authoritative DNS before enabling ACME resolver. Run one bounded real digest job, poll to terminal status and verify typed research outcomes; no fabricated candidates. Check trusted public TLS and native webhook delivery.

After new OAuth refresh or settings writes, rollback must copy current auth/settings back before restarting old runtime. Never start stale copies concurrently.
