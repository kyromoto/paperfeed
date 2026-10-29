# 12-Factor-Report

Bewertung von paperfeed gegen die zwölf Faktoren von [12factor.net](https://12factor.net).

- **Stand:** v1.8.2, 2026-10-29
- **Pflege:** Bei Änderungen an Konfiguration, Zustandshaltung, Prozessmodell, Shutdown, Logging oder Docker/CI sowie bei Umsetzung eines verlinkten Backlog-Punkts Status, Ist-Zustand und Gesamtergebnis hier aktualisieren (siehe `CLAUDE.md`).
- **Offene Aufgaben:** [`BACKLOG.md`](BACKLOG.md), Abschnitt „12-Factor“.

**Eingriff in die Codebasis:** **Gering** = unter 1 h, 1–2 Dateien. **Mittel** = Stunden, 3–6 Dateien, Verhalten ändert sich. **Hoch** = Architektur- oder Datenmodell-Umbau.

## Gesamtergebnis

5 ✅ konform, 4 ⚠️ teilweise, 3 ❌ nicht konform.

## Tabelle

| # | Faktor | Status | Ist-Zustand | Soll-Zustand | Eingriff | Backlog |
|---|---|---|---|---|---|---|
| I | Codebase | ✅ | Ein Repo, ein Deploy-Artefakt (Docker-Image via semantic-release). Config-Dateien sind per `.gitignore` ausgeschlossen. | – | – | – |
| II | Abhängigkeiten | ✅ | `package-lock.json`, `npm ci`, Multi-Stage-Build. `npm ci --only=production` ist deprecated. `dotenv` ist Prod-Dependency und wird in `main.ts` immer geladen. | `--omit=dev`. `dotenv` nur im Dev-Script (`tsx --env-file` übernimmt das bereits). | Gering | Quick Wins |
| III | Konfiguration | ❌ | Fast die gesamte Konfiguration (Redis-URL, Port, Webhook-URL, Google-Private-Key, Paperless-Passwörter) steht in einer YAML-Datei (`CONFIG_PATH`). Nur `LOG_LEVEL`, `NODE_ENV`, `CONFIG_PATH` kommen aus der Umgebung. Secrets liegen im Klartext auf der Platte. `NODE_ENV` wird geparst, aber nicht genutzt. | Infrastruktur und Secrets aus Env-Variablen (`REDIS_URL`, `PORT`, `WEBHOOK_URL`, `DATA_PATH`, Secrets via Env/Docker-Secrets). Die YAML behält nur die Account-Topologie. | **Mittel** | Env-basierte Konfiguration |
| IV | Backing Services | ⚠️ | Redis und Paperless sind per URL austauschbar, die URLs stehen aber in der YAML. SQLite ist eine lokale Datei, kein anhängbarer Dienst. | URLs aus Env. Zustand (Tokens, Channels) in einem anhängbaren Store (Redis). | Gering (URLs), **Hoch** (SQLite→Redis) | Env-basierte Konfiguration, Stateless |
| V | Build, Release, Run | ✅ | CI (semantic-release) → versioniertes Docker-Image → Run mit `node build/main.js`. Kein `HEALTHCHECK`, kein Lint in der CI. | `HEALTHCHECK` auf `/health`, `biome check` in der CI. | Gering | Quick Wins |
| VI | Prozesse (stateless) | ❌ | Lokaler Zustand: SQLite (`change_tokens`, `drive_channels`) und Temp-Dateien in `{data_path}/files`. `monitors`/`processors` sind In-Memory-Maps, der Webhook ordnet Accounts über die im Speicher gehaltene `channelId` zu. Eine zweite Instanz ohne geteiltes Volume verliert Webhooks, Change-Tokens driften auseinander. | Zustandsloser Prozess: Change-Token und Channel-State in Redis. Dateien im Job-Scope streamen oder in geteiltem Storage ablegen. | **Hoch** | Stateless |
| VII | Port Binding | ✅ | Express bindet selbst (`app.listen`). Der Port kommt aus der YAML. | Port aus `PORT`. | Gering | Env-basierte Konfiguration |
| VIII | Nebenläufigkeit | ⚠️ | BullMQ und Concurrency-Settings sind gut vorbereitet, Jobs über deterministische jobIds idempotent. Webhook-Server, drei Worker und der `setInterval`-Scheduler laufen aber in einem Prozess. `process` ist auf Concurrency 1 begrenzt (FileStore-Kollision). | Prozesstypen `web`, `worker`, `scheduler` trennen. Scheduler als BullMQ-Repeatable-Job. FileStore-Pfade pro Job eindeutig. | **Mittel–Hoch** | Prozesstypen |
| IX | Disposability | ⚠️ | Schneller Start. Shutdown über `catch-exit`, aber `worker.close()` fehlt: laufende Jobs werden abgebrochen. `server.close` und `monitor.stop` werden nicht abgewartet, `db.close()` kann zu früh laufen. | Sequentieller Shutdown mit Timeout: HTTP stoppen, `await worker.close()`, dann Queues, Redis, DB schließen. | **Gering–Mittel** | Geordneter Shutdown |
| X | Dev/Prod-Parität | ✅ | docker-compose mit Redis, Paperless, Bull-Board und ngrok bildet dieselben Backing Services ab. `docker-compose.yml` ist per `.gitignore` ausgeschlossen, das Dev-Setup ist daher nicht aus dem Repo reproduzierbar. | `docker-compose.example.yml` und `config.example.yml` einchecken. | Gering | Quick Wins |
| XI | Logs | ✅ | Logtape nach stdout, Redaction für JWT und Private-Key. `console.error` in `lib.ts` und `console.info` in `main.ts` umgehen den Logger. Env und Debug-Config werden komplett geloggt. Kein JSON-Format. | Alles über Logtape, JSON in Produktion, Config nicht komplett loggen. | Gering | Quick Wins |
| XII | Admin-Prozesse | ❌ | Migrationen laufen implizit beim Start (`db.ts`). Kein CLI für Token-Reset, Channel-Reset, Re-Queue oder Config-Check. | Einmal-Kommandos im selben Image (`node build/cli.js migrate \| reset-token \| requeue \| validate-config`). Migrationen als eigener Schritt. | **Mittel** | Admin-CLI |

## Weitere Befunde

| Thema | Befund | Eingriff | Backlog |
|---|---|---|---|
| Webhook-Sicherheit | Es wird nur `X-Goog-Channel-Id` geprüft, nicht `X-Goog-Channel-Token`. Wer die Channel-ID kennt, kann Jobs auslösen. | Gering | Webhook-Token |
| README | Beschreibt noch die Delayed-Job-Erneuerung und `data_path` als „change tokens“. | Gering | README |

## Empfohlene Reihenfolge

1. Quick Wins: II, V, X, XI, Webhook-Token, README.
2. IX (Shutdown), danach III (Env-Konfiguration mit YAML-Fallback).
3. XII (CLI), dann VIII (Prozesstypen).
4. VI (Stateless) zuletzt und nur bei Bedarf an horizontaler Skalierung. Für Single-Instance-Betrieb mit persistentem Volume ist der Zustand vertretbar.
