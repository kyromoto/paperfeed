# 12-Factor-Report

Bewertung von paperfeed gegen die zwölf Faktoren von [12factor.net](https://12factor.net).

- **Stand:** v1.8.2 + Quick Wins + Shutdown + Weitere Befunde + Admin-CLI, 2026-10-29
- **Pflege:** Bei Änderungen an Konfiguration, Zustandshaltung, Prozessmodell, Shutdown, Logging oder Docker/CI sowie bei Umsetzung eines verlinkten Backlog-Punkts Status, Ist-Zustand und Gesamtergebnis hier aktualisieren (siehe `CLAUDE.md`).
- **Offene Aufgaben:** [`BACKLOG.md`](BACKLOG.md), Abschnitt „12-Factor“.

**Eingriff in die Codebasis:** **Gering** = unter 1 h, 1–2 Dateien. **Mittel** = Stunden, 3–6 Dateien, Verhalten ändert sich. **Hoch** = Architektur- oder Datenmodell-Umbau.

## Gesamtergebnis

8 ✅ konform, 2 ⚠️ teilweise (IV, VIII), 2 ❌ nicht konform (III, VI).

## Tabelle

| # | Faktor | Status | Ist-Zustand | Soll-Zustand | Eingriff | Backlog |
|---|---|---|---|---|---|---|
| I | Codebase | ✅ | Ein Repo, ein Deploy-Artefakt (Docker-Image via semantic-release). Config-Dateien sind per `.gitignore` ausgeschlossen. | – | – | – |
| II | Abhängigkeiten | ✅ | `package-lock.json`, `npm ci --omit=dev`, Multi-Stage-Build. `dotenv` entfernt (Dev lädt `.env` über `tsx --env-file`). | – | – | – |
| III | Konfiguration | ❌ | Fast die gesamte Konfiguration (Redis-URL, Port, Webhook-URL, Google-Private-Key, Paperless-Passwörter) steht in einer YAML-Datei (`CONFIG_PATH`). Nur `LOG_LEVEL`, `NODE_ENV`, `CONFIG_PATH` kommen aus der Umgebung. Secrets liegen im Klartext auf der Platte. `NODE_ENV` wird geparst, aber nicht genutzt. | Infrastruktur und Secrets aus Env-Variablen (`REDIS_URL`, `PORT`, `WEBHOOK_URL`, `DATA_PATH`, Secrets via Env/Docker-Secrets). Die YAML behält nur die Account-Topologie. | **Mittel** | Env-basierte Konfiguration |
| IV | Backing Services | ⚠️ | Redis und Paperless sind per URL austauschbar, die URLs stehen aber in der YAML. SQLite ist eine lokale Datei, kein anhängbarer Dienst. | URLs aus Env. Zustand (Tokens, Channels) in einem anhängbaren Store (Redis). | Gering (URLs), **Hoch** (SQLite→Redis) | Env-basierte Konfiguration, Stateless |
| V | Build, Release, Run | ✅ | CI (semantic-release) → versioniertes Docker-Image → Run mit `node build/main.js`. `biome ci src` läuft vor dem Release, `HEALTHCHECK` im Dockerfile (nutzt Port 3000, bei abweichendem `server.http.port` anpassen). | Healthcheck-Port aus Konfiguration (mit Env-Konfiguration). | Gering | Env-basierte Konfiguration |
| VI | Prozesse (stateless) | ❌ | Lokaler Zustand: SQLite (`change_tokens`, `drive_channels`) und Temp-Dateien in `{data_path}/files`. `monitors`/`processors` sind In-Memory-Maps, der Webhook ordnet Accounts über die im Speicher gehaltene `channelId` zu. Eine zweite Instanz ohne geteiltes Volume verliert Webhooks, Change-Tokens driften auseinander. | Zustandsloser Prozess: Change-Token und Channel-State in Redis. Dateien im Job-Scope streamen oder in geteiltem Storage ablegen. | **Hoch** | Stateless |
| VII | Port Binding | ✅ | Express bindet selbst (`app.listen`). Der Port kommt aus der YAML. | Port aus `PORT`. | Gering | Env-basierte Konfiguration |
| VIII | Nebenläufigkeit | ⚠️ | BullMQ und Concurrency-Settings sind gut vorbereitet, Jobs über deterministische jobIds idempotent. Webhook-Server, drei Worker und der `setInterval`-Scheduler laufen aber in einem Prozess. `process` ist auf Concurrency 1 begrenzt (FileStore-Kollision). | Prozesstypen `web`, `worker`, `scheduler` trennen. Scheduler als BullMQ-Repeatable-Job. FileStore-Pfade pro Job eindeutig. | **Mittel–Hoch** | Prozesstypen |
| IX | Disposability | ✅ | Schneller Start. `src/shutdown.ts` (`setupShutdownHandler`) fährt bei SIGINT/SIGTERM/SIGHUP und uncaughtException sequentiell herunter: HTTP-Server → Scheduler → Worker (`worker.close()` wartet auf aktive Jobs) → Monitors (`channels.stop`) → Queues → Redis → DB, mit 30-s-Timeout. `catch-exit` entfernt (wartete nicht auf async Callbacks). | – | – | – |
| X | Dev/Prod-Parität | ✅ | docker-compose mit Redis, Paperless, Bull-Board und ngrok bildet dieselben Backing Services ab. `docker-compose.example.yml` und `config.example.yml` sind eingecheckt. | – | – | – |
| XI | Logs | ✅ | Logtape nach stdout, Redaction für JWT und Private-Key, JSON Lines bei `NODE_ENV=production`. Kein `console.*` mehr außerhalb des Loggers, Env und Config werden nicht mehr komplett geloggt. | – | – | – |
| XII | Admin-Prozesse | ✅ | `src/cli.ts` im selben Image: `validate-config [--online]`, `migrate`, `reset-token`, `reset-channel`, `requeue` (`node build/cli.js <cmd>`, siehe README; `requeue` mit Dateien im Quellordner noch nicht end-to-end getestet). Migrationen laufen weiterhin auch beim App-Start. | – | – | – |

## Weitere Befunde

Keine offenen Befunde. Erledigt: Webhook-Sicherheit (zufälliges Token pro Channel, `X-Goog-Channel-Token` wird in `controllers.ts` geprüft) und README (Poller statt Delayed-Job, `data_path`, `queue`-Optionen).

## Empfohlene Reihenfolge

1. Quick Wins und Weitere Befunde sind erledigt.
2. III (Env-Konfiguration mit YAML-Fallback). IX ist erledigt.
3. VIII (Prozesstypen). XII ist erledigt.
4. VI (Stateless) zuletzt und nur bei Bedarf an horizontaler Skalierung. Für Single-Instance-Betrieb mit persistentem Volume ist der Zustand vertretbar.

Ein inkrementeller Umbau auf Ports & Adapters verbilligt IV, VI und VIII, siehe [`CLEAN-ARCHITECTURE-REPORT.md`](CLEAN-ARCHITECTURE-REPORT.md).
