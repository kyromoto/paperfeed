# Configuration

paperfeed reads its configuration from two places:

| Source | What | Why |
|---|---|---|
| **Environment variables** | Everything that depends on the deployment: the `server` section (port, Redis, data path, webhook URL, queue tuning) plus `CONFIG_PATH`, `LOG_LEVEL`, `NODE_ENV` | Twelve-factor: deploy-specific config lives in the environment |
| **YAML file** (`CONFIG_PATH`) | The account topology: `accounts`, `drive_accounts`, `paperless_endpoints`, including their credentials | A list of structured entries does not fit flat variables. The file is read-only, lives outside the repository and is mounted at deploy time |

Check the result at any time with `node build/cli.js validate-config` (add `--online` to also test Redis, the Drive folders and the Paperless login). It never prints secret values.

## Environment variables

Empty (or whitespace-only) variables count as not set. Numbers must be plain numbers.

### General

| Variable | Required | Default | Description |
|---|---|---|---|
| `CONFIG_PATH` | yes | – | Path to the YAML file with the accounts |
| `LOG_LEVEL` | no | `info` | `trace`, `debug`, `info`, `warning`, `error` or `fatal` |
| `NODE_ENV` | no | `development` | `production` switches the log format to JSON lines |

### Server (`server.*`)

The variable name is the key path in upper case, joined with `_` (`camelCase` becomes `SNAKE_CASE`).

| Variable | YAML equivalent (old) | Type | Required | Default | Description |
|---|---|---|---|---|---|
| `SERVER_DATA_PATH` | `server.data_path` | path | **yes** | – | Directory for the SQLite database (`db/`) and temporary files (`files/`). Mount a volume here |
| `SERVER_HTTP_PORT` | `server.http.port` | number ≥ 1024 | no | `3000` | Port of the HTTP server (`/webhook`, `/health`) |
| `SERVER_QUEUE_REDIS_URL` | `server.queue.redis.url` | URL | **yes** | – | Redis connection, e.g. `redis://redis:6379` (may contain credentials) |
| `SERVER_QUEUE_REDIS_PREFIX` | `server.queue.redis.prefix` | string | no | `paperless-gdrive-link` | BullMQ key prefix. Bull Board must use the same value as `BULL_PREFIX` |
| `SERVER_QUEUE_CONCURRENCY_COLLECT` | `server.queue.concurrency.collect` | number ≥ 1 | no | `5` | Parallel `collect-changes` jobs |
| `SERVER_QUEUE_CONCURRENCY_PROCESS` | `server.queue.concurrency.process` | number ≥ 1 | no | `1` | Parallel `process-changes` jobs. Keep at `1` unless you know what you do (shared file store) |
| `SERVER_QUEUE_CONCURRENCY_RENEW` | `server.queue.concurrency.renew` | number ≥ 1 | no | `1` | Parallel `renew-channel` jobs |
| `SERVER_QUEUE_DEBOUNCE_COLLECT_CHANGES_SEC` | `server.queue.debounce.collectChangesSec` | number 0–300 | no | `5` | Wait time that merges bursts of Drive notifications into one change collection |
| `SERVER_QUEUE_RENEW_POLL_INTERVAL_SEC` | `server.queue.renewPollIntervalSec` | number ≥ 5 | no | `15` | How often channel expiry is checked. Keep it below 30 s (renewal happens 30 s before expiry) |
| `SERVER_DRIVE_MONITOR_WEBHOOK_URL` | `server.drive_monitor.webhook_url` | URL | **yes** | – | Public HTTPS base URL that Google calls (`<url>/webhook`) |

A `server:` block in the YAML is **not accepted any more**: the app refuses to start and lists the variable to set for each key.

## YAML file

Three lists, linked by `id` (any UUID). Order does not matter, ids must be unique within a list.

```yaml
accounts:                       # one processing pipeline per entry
  - id: 00000000-0000-4000-8000-000000000001
    name: Alice
    props:
      drive_account_id: 00000000-0000-4000-8000-000000000003    # -> drive_accounts[].id
      paperless_endpoint_id: 00000000-0000-4000-8000-000000000002  # -> paperless_endpoints[].id
      drive_src_folder_id: <Drive folder ID>   # files dropped here are processed
      drive_dst_folder_id: <Drive folder ID>   # processed files are moved here

drive_accounts:                 # Google service accounts
  - id: 00000000-0000-4000-8000-000000000003
    name: my-drive-account
    props:
      channel_expiration_sec: 1800   # optional, default 300, min 60: lifetime of a webhook channel
      credentials:                   # content of the service account key file from Google
        type: service_account
        project_id: my-project
        private_key_id: <id>
        private_key: |
          -----BEGIN PRIVATE KEY-----
          ...
          -----END PRIVATE KEY-----
        client_email: name@my-project.iam.gserviceaccount.com
        client_id: "<id>"
        auth_uri: https://accounts.google.com/o/oauth2/auth
        token_uri: https://oauth2.googleapis.com/token
        auth_provider_x509_cert_url: https://www.googleapis.com/oauth2/v1/certs
        universe_domain: googleapis.com

paperless_endpoints:            # Paperless-ngx instances (basic auth)
  - id: 00000000-0000-4000-8000-000000000002
    name: my-paperless
    props:
      server_url: http://paperless:8000
      credentials:
        username: user
        password: secret
```

| List | Purpose | Notes |
|---|---|---|
| `accounts` | Connects one Drive account and one Paperless endpoint with a source and a destination folder | Several accounts may share a Drive account or a Paperless endpoint. Share both folders with the service account's `client_email` |
| `drive_accounts` | Google service account used to watch and read Drive | `credentials` is the key file Google gives you (unknown extra fields are ignored) |
| `paperless_endpoints` | Where documents are uploaded (`POST /api/documents/post_document/`) | Plain `http://` is fine on an internal network |

The file contains secrets (`private_key`, `password`). Keep it out of the repository, mount it read-only (`:ro`), and on a single Docker host consider providing it as a Compose secret and pointing `CONFIG_PATH` at `/run/secrets/<name>`: unlike environment variables, secrets do not show up in `docker inspect`.

## Migrating from the old `server:` block

1. Run `node build/cli.js validate-config` against the old file: every `server.*` key is listed with the variable that replaces it.
2. Set the variables (Compose `environment:` or an env file), then delete the whole `server:` block from the YAML.
3. Containers that run the CLI or other images from the same setup (for example a `docker run … cli`) need the same variables. The Docker `HEALTHCHECK` and `docker exec` inside the app container already have them.

| Old YAML | New variable |
|---|---|
| `server.data_path: /data` | `SERVER_DATA_PATH=/data` |
| `server.http.port: 3000` | `SERVER_HTTP_PORT=3000` |
| `server.queue.redis.url: redis://broker:6379` | `SERVER_QUEUE_REDIS_URL=redis://broker:6379` |
| `server.queue.debounce.collectChangesSec: 15` | `SERVER_QUEUE_DEBOUNCE_COLLECT_CHANGES_SEC=15` |
| `server.drive_monitor.webhook_url: https://…` | `SERVER_DRIVE_MONITOR_WEBHOOK_URL=https://…` |
