# paperfeed

Use Google Drive as a watch folder for [paperless-ngx](https://docs.paperless-ngx.com/). Files dropped into a configured Drive source folder are automatically downloaded, uploaded to Paperless-ngx, and moved to a destination folder.

## How it works

1. A Google Drive webhook channel notifies the app whenever files change in the source folder.
2. A `collect-changes` worker polls the Drive changes API and enqueues one `process-changes` job per new file.
3. Each `process-changes` job downloads the file, POSTs it to the Paperless-ngx document upload endpoint, and moves it from the source to the destination folder in Drive.
4. On startup, all files already in the source folder are scanned and queued so nothing is missed while the app was offline.

Jobs are backed by [BullMQ](https://bullmq.io/) with Redis. Webhook channel renewal is handled automatically — a poller checks the persisted channel state every `renewPollIntervalSec` seconds and enqueues a `renew-channel` job when the channel expires within 30 seconds. Incoming webhooks are verified against a random per-channel token (`X-Goog-Channel-Token`).

## Requirements

- Node.js ≥ 22
- Redis
- A publicly reachable HTTPS URL for the Google Drive webhook
- A Google service account with Drive API access and the source/destination folders shared with it
- A running Paperless-ngx instance

## Limitations

**Single instance only.** Run exactly one instance of the app (one container). Running several against the same Redis or the same data directory is not supported: webhook channels and their verification token are held in the memory of the instance that created them, every instance would stop and recreate the channels of the others, and the download buffer in `SERVER_DATA_PATH` is local to the instance. Updates are done by stopping and starting the container; files that arrive in between are picked up by the scan at startup. Concurrency inside the instance is configurable (`SERVER_QUEUE_CONCURRENCY_*`). The admin CLI (`node build/cli.js …`) may run next to the running app.

## Configuration

Two sources, details and defaults in [docs/configuration.md](docs/configuration.md):

- **Environment variables** for everything deployment specific: `CONFIG_PATH`, `LOG_LEVEL`, `NODE_ENV` and the `SERVER_*` variables (port, Redis, data path, webhook URL, queue tuning).
- **A YAML file** (`CONFIG_PATH`, mounted read-only) for the accounts: `accounts`, `drive_accounts`, `paperless_endpoints` including their credentials.

Minimal environment:

```bash
CONFIG_PATH=/config/config.yml
SERVER_DATA_PATH=/data
SERVER_QUEUE_REDIS_URL=redis://redis:6379
SERVER_DRIVE_MONITOR_WEBHOOK_URL=https://your-public-url.example.com
```

> **Breaking change:** the former `server:` block in the YAML is no longer accepted. The app refuses to start and `node build/cli.js validate-config` lists the variable to set for each key. See [Migrating from the old `server:` block](docs/configuration.md#migrating-from-the-old-server-block).

For local development copy `.env.example` to `.env` (`npm run dev` and `npm run cli` read it) and `config.example.yml` to `config/config.yml`.

## Running

### Development

```bash
npm install
npm run dev
```

### Production (Docker)

```bash
docker build -t paperless-gdrive-link .
docker run \
  -e CONFIG_PATH=/config/config.yml \
  -e SERVER_DATA_PATH=/app/data \
  -e SERVER_QUEUE_REDIS_URL=redis://redis:6379 \
  -e SERVER_DRIVE_MONITOR_WEBHOOK_URL=https://your-public-url.example.com \
  -v /path/to/config:/config:ro \
  -v /path/to/data:/app/data \
  -p 3000:3000 \
  paperless-gdrive-link
```

### docker-compose example

```yaml
services:
  paperless-gdrive-link:
    image: paperless-gdrive-link
    environment:
      CONFIG_PATH: /config/config.yml
      SERVER_DATA_PATH: /app/data
      SERVER_QUEUE_REDIS_URL: redis://broker:6379
      SERVER_DRIVE_MONITOR_WEBHOOK_URL: https://your-public-url.example.com
    volumes:
      - ./config:/config:ro
      - ./data:/app/data
    ports:
      - "3000:3000"
    depends_on:
      - broker

  broker:
    image: redis:7-alpine
```

## Development

```bash
npm test            # run all tests once (Vitest, src/**/*.test.ts)
npm run test:watch  # watch mode
npx biome check     # lint and format check
```

Tests live next to the code (`src/<module>.test.ts`) and need no external services.

## Admin CLI

One-off maintenance commands ship in the same image and use the same `CONFIG_PATH` and environment as the app. They can run next to a running app (SQLite uses WAL).

```bash
node build/cli.js <command>                         # in the container
docker exec <container> node build/cli.js <command> # against a running container
npm run cli -- <command>                            # local development
```

| Command | Description |
|---|---|
| `validate-config [--online]` | Validates the config file and cross references. `--online` also checks Redis, the Drive source/destination folders and the Paperless login. |
| `healthcheck` | Calls `GET /health` of the local app on the port from `server.http.port`. Used by the Docker `HEALTHCHECK`, exit code `0` when healthy. |
| `migrate` | Runs the SQLite migrations in `{data_path}/db` without starting the app. |
| `reset-token <account>` | Deletes the stored Drive change token. Changes made before the next collect are not tracked, run `requeue` afterwards. |
| `reset-channel <account>` | Stops the persisted webhook channel at Google and deletes its state. A running app creates a new channel via the renewal poller. |
| `requeue <account>` | Queues all files currently in the source folder for processing (duplicates are prevented by the job deduplication id). |

`<account>` is the `id` or `name` of an entry in `accounts`. Exit codes: `0` success, `1` error, `2` usage error.

## Queue monitoring (Bull Board)

The app has no admin UI of its own. Run [Bull Board](https://github.com/felixmosh/bull-board) as a separate container next to Redis (see `docker-compose.example.yml`, image `deadly0/bull-board`) and keep it on the internal Docker network only, it has no authentication:

- `REDIS_HOST` / `REDIS_PORT` point to the Redis used by the app.
- `BULL_PREFIX` must equal `server.queue.redis.prefix` from the config (default `paperless-gdrive-link`).
- It shows `collect-changes`, `process-changes` and `renew-channel`, including retries and failed channel renewals.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhook` | Receives Google Drive push notifications |
| `GET` | `/health` | Health check |

## License

MIT
