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

## Configuration

The app is configured via a YAML file. Set `CONFIG_PATH` to point to it.

```yaml
server:
  data_path: data               # SQLite database (db/) and temporary files (files/)
  http:
    port: 3000
  queue:
    redis:
      url: redis://localhost:6379
      prefix: paperless-gdrive-link   # optional, BullMQ key prefix
    concurrency:                      # optional worker concurrency
      collect: 5
      process: 1
      renew: 1
    debounce:
      collectChangesSec: 5            # optional, debounce for webhook-triggered change collection
    renewPollIntervalSec: 15          # optional, how often channel expiry is checked (keep below 30)
  drive_monitor:
    webhook_url: https://your-public-url.example.com

drive_accounts:
  - id: <uuid>
    name: my-drive-account
    props:
      channel_expiration_sec: 3600   # how long each webhook channel lives
      credentials:                    # Google service account JSON (inline)
        type: service_account
        project_id: ...
        private_key: |
          -----BEGIN PRIVATE KEY-----
          ...
          -----END PRIVATE KEY-----
        client_email: ...@....iam.gserviceaccount.com
        # ... remaining service account fields

paperless_endpoints:
  - id: <uuid>
    name: my-paperless
    props:
      server_url: http://paperless:8000
      credentials:
        username: user
        password: secret

accounts:
  - id: <uuid>
    name: Alice
    props:
      drive_account_id: <drive_accounts[*].id>
      paperless_endpoint_id: <paperless_endpoints[*].id>
      drive_src_folder_id: <Google Drive folder ID>
      drive_dst_folder_id: <Google Drive folder ID>
```

Multiple `accounts` can be defined; each gets its own independent processing pipeline.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `CONFIG_PATH` | yes | Path to the YAML config file |
| `LOG_LEVEL` | no | `trace` / `debug` / `info` / `warning` / `error` / `fatal` (default: `info`) |
| `NODE_ENV` | no | `development` / `production` (default: `development`) |

For local development, put these in a `.env` file — `npm run dev` reads it automatically.

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
  -e NODE_ENV=production \
  -v /path/to/config:/config \
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
      NODE_ENV: production
    volumes:
      - ./config:/config
      - ./data:/app/data
    ports:
      - "3000:3000"
    depends_on:
      - broker

  broker:
    image: redis:7-alpine
```

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
| `migrate` | Runs the SQLite migrations in `{data_path}/db` without starting the app. |
| `reset-token <account>` | Deletes the stored Drive change token. Changes made before the next collect are not tracked, run `requeue` afterwards. |
| `reset-channel <account>` | Stops the persisted webhook channel at Google and deletes its state. A running app creates a new channel via the renewal poller. |
| `requeue <account>` | Queues all files currently in the source folder for processing (duplicates are prevented by the job deduplication id). |

`<account>` is the `id` or `name` of an entry in `accounts`. Exit codes: `0` success, `1` error, `2` usage error.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhook` | Receives Google Drive push notifications |
| `GET` | `/health` | Health check |

## License

MIT
