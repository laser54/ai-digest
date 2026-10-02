# AI Digest on Coolify

Existing production migration, one replica; no invented DEV.
Resource `AI Digest PROD`, `csfb4gpyqudfgjekt0ebwwij`, target `38.45.65.134`.
GitHub App source `laser54/ai-digest/main`, raw Compose `/docker-compose.coolify.yml`.

## Runtime contract

Native Docker build, no legacy SSH deploy or GHCR image-tag indirection. CI tests and builds only. Keep non-root node, read-only root, init, no-new-privileges, dropped capabilities, pids_limit and tmpfs. Only /codex is persistent; actual volume must be discovered from container mounts. Runtime-only ADMIN_PASSWORD comes from `AI_DIGEST_PROD_ADMIN_PASSWORD` in Bitwarden through Coolify; no build argument secrets.

## Preparation acceptance

Local suite: 125 tests passed. Existing auth/settings and Codex service state snapshot captured: SQLite backup API merges live WAL safely, integrity checked; non-SQLite files copied, auth/settings hashes checked before/after. Transient /codex/tmp excluded. Auth/session archives are sensitive; keep backups private, never Git or browser bundles.

Preparation snapshot is not the final cutover snapshot. No app jobs/results DB: in-memory queues/results disappear on restart. New settings/auth must be refreshed after separately approved old stop.

## OAuth ownership fence

Never run copied Codex OAuth credentials concurrently on both hosts: refresh-token rotation can invalidate one copy. Pre-cutover verification covers routing, settings equality, execution auth rejection/acceptance, runtime isolation and local tests; REAL Codex generation is deferred until the old runtime is stopped and the newest auth is copied. Do not substitute mocked generation results for runtime evidence.

## Cutover (separate approval)

Gate destination execution, inspect old active Codex processes/jobs and agree handling of in-memory work; stop old app only, preserve old data. Obtain final frozen /codex snapshot, verify backup/restore, then change only ai-digest.larin.work DNS. Verify authoritative DNS before enabling ACME resolver. Run one bounded real digest job, poll to terminal status and verify typed research outcomes; no fabricated candidates. Check trusted public TLS and native webhook delivery.

After new OAuth refresh or settings writes, rollback must copy current auth/settings back before restarting old runtime. Never start stale copies concurrently.
