# 12-Factor-Report

Bewertung von paperfeed gegen die zwölf Faktoren von [12factor.net](https://12factor.net).

- **Stand:** v1.9.x + Quick Wins + Shutdown + Weitere Befunde + Admin-CLI + Env-Konfiguration, 2026-10-29
- **Pflege:** Bei Änderungen an Konfiguration, Zustandshaltung, Prozessmodell, Shutdown, Logging oder Docker/CI sowie bei Umsetzung eines verlinkten Backlog-Punkts Status, Ist-Zustand und Gesamtergebnis hier aktualisieren (siehe `CLAUDE.md`).
- **Offene Aufgaben:** [`BACKLOG.md`](BACKLOG.md), Abschnitt „12-Factor“.

**Eingriff in die Codebasis:** **Gering** = unter 1 h, 1–2 Dateien. **Mittel** = Stunden, 3–6 Dateien, Verhalten ändert sich. **Hoch** = Architektur- oder Datenmodell-Umbau.

## Gesamtergebnis

9 ✅ konform (III mit dokumentierter Abweichung), 2 ⚠️ teilweise (IV, VIII), 1 ❌ nicht konform (VI).

## Tabelle

| # | Faktor | Status | Ist-Zustand | Soll-Zustand | Eingriff | Backlog |
|---|---|---|---|---|---|---|
| I | Codebase | ✅ | Ein Repo, ein Deploy-Artefakt (Docker-Image via semantic-release). Config-Dateien sind per `.gitignore` ausgeschlossen. | – | – | – |
| II | Abhängigkeiten | ✅ | `package-lock.json`, `npm ci --omit=dev`, Multi-Stage-Build. `dotenv` entfernt (Dev lädt `.env` über `tsx --env-file`). | – | – | – |
| III | Konfiguration | ✅ (bewusste Abweichung) | Der `server`-Abschnitt (Port, Redis, Datenpfad, Webhook-URL, Queue-Tuning) kommt ausschließlich aus `SERVER_*`-Umgebungsvariablen (`src/config-env.ts`, Referenz `docs/configuration.md`). Die Account-Topologie (`accounts`, `drive_accounts`, `paperless_endpoints`) bleibt inklusive Zugangsdaten in einer schreibgeschützten YAML außerhalb des Repos, die beim Deployment eingehängt wird. Strikt gelesen liegen damit Secrets weiter in einer Datei; der Kerntest „Code ließe sich ohne Geheimnisse veröffentlichen“ ist erfüllt. | Optional: Secrets zusätzlich per Umgebung bzw. `*_FILE` (bewusst nicht umgesetzt). Auf einem Docker-Host die YAML als Compose-Secret einhängen. | – | – |
| IV | Backing Services | ⚠️ | Redis und Paperless sind per URL austauschbar, die Redis-URL kommt aus `SERVER_QUEUE_REDIS_URL`. SQLite ist weiterhin eine lokale Datei, kein anhängbarer Dienst. | Zustand (Tokens, Channels) in einem anhängbaren Store (Redis). | **Hoch** (SQLite→Redis, siehe VI) | Stateless |
| V | Build, Release, Run | ✅ | CI (semantic-release) → versioniertes Docker-Image → Run mit `node build/main.js`. `biome ci src` läuft vor dem Release, `HEALTHCHECK` im Dockerfile ruft `node build/cli.js healthcheck` auf und liest den Port aus der Config. | – | – | – |
| VI | Prozesse (stateless) | ❌ | Lokaler Zustand: SQLite (`change_tokens`, `drive_channels`) und Temp-Dateien in `{data_path}/files`. `monitors`/`processors` sind In-Memory-Maps, der Webhook ordnet Accounts über die im Speicher gehaltene `channelId` zu. Eine zweite Instanz ohne geteiltes Volume verliert Webhooks, Change-Tokens driften auseinander. | Zustandsloser Prozess: Change-Token und Channel-State in Redis. Dateien im Job-Scope streamen oder in geteiltem Storage ablegen. | **Hoch** | Stateless |
| VII | Port Binding | ✅ | Express bindet selbst (`app.listen`), der Port kommt aus `SERVER_HTTP_PORT` (Default 3000). | – | – | – |
| VIII | Nebenläufigkeit | ⚠️ | BullMQ und Concurrency-Settings sind gut vorbereitet, Jobs über deterministische jobIds idempotent. Webhook-Server, drei Worker und der `setInterval`-Scheduler laufen aber in einem Prozess. `process` ist auf Concurrency 1 begrenzt (FileStore-Kollision). | Prozesstypen `web`, `worker`, `scheduler` trennen. Scheduler als BullMQ-Repeatable-Job. FileStore-Pfade pro Job eindeutig. | **Mittel–Hoch** | Prozesstypen |
| IX | Disposability | ✅ | Schneller Start. `src/shutdown.ts` (`setupShutdownHandler`) fährt bei SIGINT/SIGTERM/SIGHUP und uncaughtException sequentiell herunter: HTTP-Server → Scheduler → Worker (`worker.close()` wartet auf aktive Jobs) → Monitors (`channels.stop`) → Queues → Redis → DB, mit 30-s-Timeout. `catch-exit` entfernt (wartete nicht auf async Callbacks). | – | – | – |
| X | Dev/Prod-Parität | ✅ | docker-compose mit Redis, Paperless, Bull-Board und ngrok bildet dieselben Backing Services ab. `docker-compose.example.yml` und `config.example.yml` sind eingecheckt. | – | – | – |
| XI | Logs | ✅ | Logtape nach stdout, Redaction für JWT und Private-Key, JSON Lines bei `NODE_ENV=production`. Kein `console.*` mehr außerhalb des Loggers, Env und Config werden nicht mehr komplett geloggt. | – | – | – |
| XII | Admin-Prozesse | ✅ | `src/cli.ts` im selben Image: `validate-config [--online]`, `migrate`, `reset-token`, `reset-channel`, `requeue` (`node build/cli.js <cmd>`, siehe README; `requeue` am 2026-10-29 manuell end-to-end geprüft: Jobs, Deduplizierung, Verarbeitung bis Paperless und Zielordner). Migrationen laufen weiterhin auch beim App-Start. | – | – | – |

## Weitere Befunde

Keine offenen Befunde. Erledigt: Webhook-Sicherheit (zufälliges Token pro Channel, `X-Goog-Channel-Token` wird in `controllers.ts` geprüft) und README (Poller statt Delayed-Job, `data_path`, `queue`-Optionen).

## Empfohlene Reihenfolge

1. Quick Wins und Weitere Befunde sind erledigt.
2. III und IX sind erledigt.
3. VIII (Prozesstypen). XII ist erledigt.
4. VI (Stateless) zuletzt und nur bei Bedarf an horizontaler Skalierung. Für Single-Instance-Betrieb mit persistentem Volume ist der Zustand vertretbar.

Ein inkrementeller Umbau auf Ports & Adapters verbilligt IV, VI und VIII, siehe [`CLEAN-ARCHITECTURE-REPORT.md`](CLEAN-ARCHITECTURE-REPORT.md).
