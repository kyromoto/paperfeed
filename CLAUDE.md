# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # run with tsx watch (hot-reload), reads .env automatically
npm run build      # compile TypeScript to ./build/

npx biome check          # lint + format check
npx biome lint           # lint only
npx biome format         # show format diff (read-only)
npx biome format --write # apply formatting
```

There is no test suite.

Required env vars (put in `.env` for dev):
- `CONFIG_PATH` — path to YAML config file (e.g. `config/config.yml`)
- `LOG_LEVEL` — `trace | debug | info | warning | error | fatal` (default: `info`)
- `NODE_ENV` — `development | production` (default: `development`)

## Architecture

**Purpose:** Bridges Google Drive and Paperless-ngx. Files dropped into a Drive "src folder" are downloaded, uploaded to Paperless-ngx, and moved to a Drive "dst folder".

### Config model (`src/types.ts`)

Three top-level entities defined in the YAML config and validated with Zod:
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
    │  jobId = "collect-changes-{accountId}"  ← deterministic, prevents duplicate concurrent jobs
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
| `src/drive-monitor.ts` | Manages one Google Drive webhook channel per account; on `start()` first attempts to stop the previously persisted channel (if any), then creates a new channel and persists `{channelId, resourceId, expiration}` to SQLite. Does not schedule its own renewal. |
| `src/channel-renewal-scheduler.ts` | `startChannelRenewalScheduler()` — in-process `setInterval` poller. Every `renewPollIntervalSec`, checks each account's channel state in SQLite; if expiration is within 30s (`RENEW_OFFSET_MS`), enqueues a `renew-channel` job. |
| `src/db.ts` | Opens the SQLite database at `{data_path}/paperfeed.db`, runs schema migrations (`change_tokens`, `drive_channels` tables) |
| `src/change-token-repository.ts` | `ChangeTokenRepository` — get/set the Drive change token per `(accountId, folderId)` |
| `src/channel-repository.ts` | `ChannelRepository` — get/upsert the current Drive channel state per account |
| `src/file-processor.ts` | `getUnprocessedFiles()` + `processFile()` — the core business logic |
| `src/file-store.ts` | Thin wrapper around local filesystem for buffering files between download and upload |
| `src/lib.ts` | `listFilesRecursive`, `listChangesRecursive` (reads/writes change token via `ChangeTokenRepository`), `getDriveClient` |
| `src/queue-processor.ts` | BullMQ job handler functions (thin adapters into `FileProcessor`) |
| `src/queue-utils.ts` | `attachWorkerLogging` (worker event listeners) + `collectOutstandingJobs` (startup scan helper) |
| `src/controllers.ts` | Express route handlers for `/webhook` and `/health` |
| `src/config-repository.ts` | Reads/writes the YAML config file; parses with Zod |
| `src/repositories.ts` | `ConfigRepository` interface — abstracts config read access |
| `src/env.ts` | Validates and exports env vars via Zod — **throws at import time** if `CONFIG_PATH` is missing |

### Important invariants

- The `collect-changes` jobId is `collect-changes-${accountId}` (deterministic). This prevents concurrent collect jobs for the same account from racing on the Drive change token. Do not change it to a random ID.
- The `process-changes` jobId is `process-changes-${accountId}-${fileId}` (deterministic). This prevents the same file from being downloaded/uploaded to Paperless twice concurrently (FileStore collision). Do not change it to a random ID.
- The `renew-channel` jobId is `renew-channel-${accountId}-${timestamp}` combined with `deduplication.id = renew-channel-${accountId}`, mirroring the `process-changes` pattern. Jobs are only ever enqueued with `delay: 0` by `ChannelRenewalScheduler` when the poller determines renewal is due — there is never an overlapping *delayed* job to conflict with, so the jobId can be freshly generated each time without the removal/tracking dance the old delayed-job design needed.
- Channel state (`channelId`, `resourceId`, `expiration`) lives in SQLite (`drive_channels` table), not in-memory or in a BullMQ delayed job. `DriveMonitor.start()` reads any previously persisted state for the account and tries to stop that channel with Google (best-effort — failures are logged, not thrown, since the old channel may already be expired or invalid), then always creates a fresh channel and persists the new state. It does not schedule anything itself. `ChannelRenewalScheduler` is the sole reader of this state during runtime and the sole thing that decides when to renew, polling every `config.server.queue.renewPollIntervalSec` seconds (default 15s — keep this smaller than `RENEW_OFFSET_MS`/30s so a channel is never allowed to actually expire before renewal is detected as due). `resourceId` is required (alongside `channelId`) by Google's `channels.stop` API — without it, stop calls fail silently.
- The `renew-channel` queue has `attempts: 3` with exponential backoff, so a transient Drive API failure during renewal no longer silently leaves the channel to expire.
- The Drive change token is persisted in SQLite (`change_tokens` table, keyed by `(accountId, folderId)`) via `ChangeTokenRepository`. On first read after upgrading from the pre-SQLite version, a one-time fallback in `lib.ts` (`readLegacyChangeToken`) migrates the token from the old `{data_path}/tokens/{accountId}.{folderId}.change-token.txt` file if present. If neither exists, the app bootstraps a fresh token from `changes.getStartPageToken`.
- `process-changes` worker runs with concurrency 1 by default. Increasing it risks concurrent FileStore access for the same file (same `{accountId}_{fileId}` path).
- `@logtape/redaction` automatically strips JWTs and private keys from logs. Do not bypass the logger for sensitive config fields.

## Diagrams

[`app-sequence.mermaid`](app-sequence.mermaid) is the authoritative flow diagram. **Update it whenever the processing pipeline changes** (queue names, jobId scheme, step order, new/removed actors). It reflects the current state including RC fixes.

## Backlog

Open work items are tracked in [`BACKLOG.md`](BACKLOG.md). Read it before working on race conditions or the DriveMonitor.
