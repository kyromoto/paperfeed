# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # run with tsx watch (hot-reload), reads .env automatically
npm run build      # compile TypeScript to ./build/ (tsconfig.build.json, excludes tests)
npm test           # run all tests once (vitest, src/**/*.test.ts)
npm run test:watch # tests in watch mode

npx biome check          # lint + format check
npx biome lint           # lint only
npx biome format         # show format diff (read-only)
npx biome format --write # apply formatting
```

Tests (Vitest) live next to the code as `src/<module>.test.ts`. They are excluded from `npm run build` and the Docker image, but `npx tsc --noEmit` type-checks them. They must run offline (no Redis, Docker, Google, Paperless); use in-memory SQLite (`new Database(":memory:")` + `migrate(db)`) or fakes. New pure logic and fixes for specified behavior come with a test; CI runs `npm test` before the release.

Configuration reference: [`docs/configuration.md`](docs/configuration.md) — **keep it in sync** whenever config keys, `SERVER_*` variables, defaults or the YAML schema change. For dev copy `.env.example` to `.env`.

Required env vars (put in `.env` for dev):
- `CONFIG_PATH` — path to the YAML file with the accounts (e.g. `config/config.yml`), read-only
- `SERVER_DATA_PATH`, `SERVER_QUEUE_REDIS_URL`, `SERVER_DRIVE_MONITOR_WEBHOOK_URL` — required `server` settings (all other `SERVER_*` have defaults, see docs)
- `LOG_LEVEL` — `trace | debug | info | warning | error | fatal` (default: `info`)
- `NODE_ENV` — `development | production` (default: `development`)

## Architecture

**Purpose:** Bridges Google Drive and Paperless-ngx. Files dropped into a Drive "src folder" are downloaded, uploaded to Paperless-ngx, and moved to a Drive "dst folder".

### Config model (`src/types.ts`, `src/config-env.ts`)

The configuration is **composed** by `composeConfig()` (`src/config-env.ts`, pure, unit-tested): the `server` section comes **only** from `SERVER_*` environment variables (explicit table `SERVER_VARIABLES`, hierarchy kept in the name, e.g. `server.http.port` → `SERVER_HTTP_PORT`), the account topology from the read-only YAML at `CONFIG_PATH`. The result is validated with the unchanged Zod `Config` schema. A `server:` block in the YAML is rejected with the replacing variable names; errors name variables and key paths, never values (Redis URLs and YAML snippets can contain secrets). Secrets (`private_key`, `password`) stay in the YAML on purpose (read-only file outside the repo, mounted at deploy time).

Three top-level entities are defined in the YAML config:
- `DriveAccount` — Google service account credentials + channel expiry settings
- `PaperlessEndpoint` — Paperless-ngx server URL + basic auth credentials
- `Account` — joins one `DriveAccount` + one `PaperlessEndpoint` with a src and dst Drive folder ID

Multiple accounts can be configured; each gets its own `DriveMonitor` and `FileProcessor`.

### Processing pipeline

```
Google Drive (src folder)
    │
    ▼ [files.watch webhook channel]
DriveMonitor  ──persists {channelId, resourceId, expiration}──▶  SQLite (drive_channels table)
    │                                                       ▲
    │                                                       │ polls every renewPollIntervalSec
    │                                                ChannelRenewalScheduler (setInterval, in-process)
    │                                                       │ due (expiration - now <= 30s)?
    │                                                       ▼
    │                                          renew-channel Queue  (BullMQ/Redis)
    │                                             jobId = "renew-channel-{accountId}-{timestamp}"
    │                                             deduplication.id = "renew-channel-{accountId}"
    │                                             attempts: 3, exponential backoff
    │                                                       │
    │◀──────────────────────── Worker calls monitor.start() ┘
    │ Google Drive sends HTTP POST
    ▼
POST /webhook  (controllers.ts)
    │  validates X-Goog-Channel-Id against active monitors
    ▼
collect-changes Queue  (BullMQ/Redis)
    │  jobId = "collect-changes-{accountId}-{timestamp}"
    │  deduplication.id = "collect-changes-{accountId}"  ← debounce (ttl + extend + replace, delay = debounce)
    ▼
collect-changes Worker  (queue-processor.ts)
    │  calls Drive changes.list API, uses change token from SQLite
    │  writes updated change token back to SQLite
    ▼
process-changes Queue  (BullMQ/Redis, one job per file)
    ▼
process-changes Worker
    │  1. download file from Drive → FileStore (local temp, {data_path}/files/)
    │  2. POST to Paperless-ngx /api/documents/post_document/
    │  3. Move file in Drive: removeParents=src, addParents=dst
    ▼
Done
```

On startup, all files currently in the src folder are scanned and queued directly into `process-changes` (bypassing collect), so nothing is missed while the app was offline.

### Key components

| File | Role |
|---|---|
| `src/main.ts` | Wires everything together; owns queue/worker setup and startup scan |
| `src/shutdown.ts` | `setupShutdownHandler()` — signal/uncaughtException handler with ordered shutdown (http → scheduler → workers → monitors → queues → redis → db, 30s timeout). Registered at the end of `main()` once all resources exist. Replaces `catch-exit`, which does not await async callbacks. |
| `src/cli.ts` | Admin CLI (`node build/cli.js <cmd>`, `npm run cli -- <cmd>`): `validate-config [--online]`, `healthcheck` (used by the Dockerfile `HEALTHCHECK`, port from config), `migrate`, `reset-token`, `reset-channel`, `requeue`. Exit codes 0/1/2. Dynamic imports keep `help` working without `CONFIG_PATH`. Closes SQLite/Redis/queues after every command. |
| `src/version.ts` | `APP_VERSION` read from `package.json` (`npm_package_version` is only set when started via npm) |
| `src/logging.ts` | `configureLogging()` — shared by app and CLI (redaction, JSON lines in production) |
| `src/queues.ts` | `connectRedis()` and `createQueues()` — queue names and default job options, shared by app and CLI so `requeue` behaves like the startup scan |
| `src/drive-monitor.ts` | Manages one Google Drive webhook channel per account; on `start()` first attempts to stop the previously persisted channel (if any), then creates a new channel and persists `{channelId, resourceId, expiration}` to SQLite. Does not schedule its own renewal. |
| `src/channel-renewal-scheduler.ts` | `startChannelRenewalScheduler()` — in-process `setInterval` poller. Every `renewPollIntervalSec`, checks each account's channel state in SQLite; if expiration is within 30s (`RENEW_OFFSET_MS`), enqueues a `renew-channel` job. |
| `src/db.ts` | Opens the SQLite database at `{data_path}/db/paperfeed.db` (creates the `db` subfolder if missing), runs schema migrations (`change_tokens`, `drive_channels` tables) |
| `src/change-token-repository.ts` | `ChangeTokenRepository` — get/set the Drive change token per `(accountId, folderId)` |
| `src/channel-repository.ts` | `ChannelRepository` — get/upsert the current Drive channel state per account |
| `src/file-processor.ts` | `getUnprocessedFiles()` + `processFile()` — the core business logic |
| `src/file-store.ts` | Thin wrapper around local filesystem for buffering files between download and upload |
| `src/lib.ts` | `listFilesRecursive`, `listChangesRecursive` (reads/writes change token via `ChangeTokenRepository`), `getDriveClient` |
| `src/queue-processor.ts` | BullMQ job handler functions (thin adapters into `FileProcessor`) |
| `src/queue-utils.ts` | `attachWorkerLogging` (worker event listeners) + `collectOutstandingJobs` (startup scan helper) |
| `src/controllers.ts` | Express route handlers for `/webhook` and `/health` |
| `src/config-env.ts` | `composeConfig()`, `parseYaml()`, `SERVER_VARIABLES`, `ConfigError` — builds the `server` section from env, merges with the YAML accounts, validates with Zod |
| `src/config-repository.ts` | Reads the YAML file (read-only, no write) and returns `composeConfig(...)` |
| `src/repositories.ts` | `ConfigRepository` interface — abstracts config read access |
| `src/env.ts` | Validates and exports env vars via Zod — **throws at import time** if `CONFIG_PATH` is missing |

### Important invariants

- The `collect-changes` job uses `deduplication.id = collect-changes-${accountId}` (jobId is `collect-changes-${accountId}-${timestamp}`) in debounce mode (`ttl` and `delay` = `collectChangesSec`, `extend`, `replace`). Bursts of webhooks for the same account collapse into one job, so collect jobs do not race on the Drive change token. Do not drop the deduplication id.
- The `process-changes` job uses `deduplication.id = process-changes-${accountId}-${fileId}` (jobId is `process-changes-${accountId}-${fileId}-${timestamp}`, built in `main.ts` and `queue-utils.ts`). This prevents the same file from being downloaded/uploaded to Paperless twice concurrently (FileStore collision). Do not drop the deduplication id.
- The `renew-channel` jobId is `renew-channel-${accountId}-${timestamp}` combined with `deduplication.id = renew-channel-${accountId}`, mirroring the `process-changes` pattern (timestamped jobId + `deduplication.id`). Jobs are only ever enqueued with `delay: 0` by `ChannelRenewalScheduler` when the poller determines renewal is due — there is never an overlapping *delayed* job to conflict with, so the jobId can be freshly generated each time without the removal/tracking dance the old delayed-job design needed.
- Channel state (`channelId`, `resourceId`, `expiration`) lives in SQLite (`drive_channels` table), not in-memory or in a BullMQ delayed job. `DriveMonitor.start()` reads any previously persisted state for the account and tries to stop that channel with Google (best-effort — failures are logged, not thrown, since the old channel may already be expired or invalid), then always creates a fresh channel and persists the new state. It does not schedule anything itself. `ChannelRenewalScheduler` is the sole reader of this state during runtime and the sole thing that decides when to renew, polling every `config.server.queue.renewPollIntervalSec` seconds (default 15s — keep this smaller than `RENEW_OFFSET_MS`/30s so a channel is never allowed to actually expire before renewal is detected as due). `resourceId` is required (alongside `channelId`) by Google's `channels.stop` API — without it, stop calls fail silently. `DriveMonitor.stop()` (graceful shutdown) deletes the persisted state once the channel is stopped or Google answers 404; on other errors the state is kept so the next `start()` can still try. In `start()`, a 404 for the previous channel (already stopped/expired) is logged as info, other errors as warning. Google API errors are logged compactly via `describeApiError` (status, reason, message) — never pass the raw error object to the logger, it carries the whole request and response.
- Each channel gets a random token (`files.watch` `token`) that `DriveMonitor` keeps in memory only (a fresh channel is created on every start); `handleWebhook` rejects calls whose `X-Goog-Channel-Token` does not match (`verifyChannelToken`). Never log the raw request headers without stripping that header.
- The `renew-channel` queue has `attempts: 3` with exponential backoff, so a transient Drive API failure during renewal no longer silently leaves the channel to expire.
- The Drive change token is persisted in SQLite (`change_tokens` table, keyed by `(accountId, folderId)`) via `ChangeTokenRepository`. On first read after upgrading from the pre-SQLite version, a one-time fallback in `lib.ts` (`readLegacyChangeToken`) migrates the token from the old `{data_path}/tokens/{accountId}.{folderId}.change-token.txt` file if present. If neither exists, the app bootstraps a fresh token from `changes.getStartPageToken`.
- `process-changes` worker runs with concurrency 1 by default. Increasing it risks concurrent FileStore access for the same file (same `{accountId}_{fileId}` path).
- `@logtape/redaction` automatically strips JWTs and private keys from logs. Do not bypass the logger for sensitive config fields.

## OpenSpec workflow

Specs live in `openspec/specs/` (one folder per capability, the current behavior), changes in `openspec/changes/<name>/`. **Follow the process strictly** (OpenSpec CLI 1.15.0, Claude commands under `.claude/commands/opsx/`):

1. `/opsx:propose` — create the change (`proposal.md`, delta `specs/`, `design.md`, `tasks.md`) and stop for review. No code before that.
2. `/opsx:apply <change>` — implement the tasks and tick them off.
3. `/opsx:archive <change>` — merge the delta specs into `openspec/specs/`.

Rules:
- Any change to behavior or capabilities (new command, endpoint, config option, job flow, lifecycle) goes through a change, however small. Never edit `openspec/specs/**` directly.
- No change needed for pure docs, dependency bumps, or fixes that do not alter specified behavior. If a fix contradicts a spec, change the spec through a change.
- Keep `CLAUDE.md`, `12-FACTOR-REPORT.md` and `BACKLOG.md` in sync as tasks of the change.
- Validate with `npx @fission-ai/openspec@1.15.0 validate --specs` (and `validate <change>`).

## Diagrams

[`app-sequence.mermaid`](app-sequence.mermaid) is the authoritative flow diagram. **Update it whenever the processing pipeline changes** (queue names, jobId scheme, step order, new/removed actors). It reflects the current state including RC fixes.

## 12-Factor report

[`12-FACTOR-REPORT.md`](12-FACTOR-REPORT.md) rates the app against the twelve-factor methodology (status, current vs. target state, effort per factor). **Update it whenever** config handling, state storage, process model, shutdown, logging, Docker/CI, or one of the "12-Factor" backlog items changes (status, current state, overall score, date/version).

## Backlog

Open work items are tracked in [`BACKLOG.md`](BACKLOG.md). Read it before working on race conditions or the DriveMonitor. The "12-Factor" section there derives from the 12-factor report. [`CLEAN-ARCHITECTURE-REPORT.md`](CLEAN-ARCHITECTURE-REPORT.md) evaluates a pragmatic ports-and-adapters restructuring (backlog item "Ports & Adapters"); update it if the module structure changes.
