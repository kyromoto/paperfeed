# Design

## Context

- `src/main.ts` baut Logger, Redis-Verbindung, Queues, Worker, Prozessoren und Monitore inline auf. Logging-Konfiguration (Redaction, JSON in Produktion) und Queue-Optionen (`removeOnComplete`, `attempts`, Prefix) sind dort fest verdrahtet.
- `openDatabase()` legt das Verzeichnis an, öffnet SQLite (WAL) und migriert in einem Schritt.
- `src/env.ts` validiert `CONFIG_PATH` beim Import und wirft, wenn er fehlt.
- Wiederverwendbar: `ConfigFileRepository`, `getDriveClient` (`src/lib.ts`), `FileProcessor.getUnprocessedFiles`, `collectOutstandingJobs` (`src/queue-utils.ts`), `ChannelRepository`, `ChangeTokenRepository`.

## Goals / Non-Goals

**Goals:**
- Fünf Wartungskommandos im selben Image, ohne App-Start, ohne neue Abhängigkeit.
- CLI und App verwenden identisches Logging und identische Queue-Optionen, damit eingestellte Jobs sich wie App-Jobs verhalten (Deduplizierung, Retention).

**Non-Goals:**
- `status`-Kommando, Dry-Run, interaktive Bestätigung, Web-UI.
- Umbau auf Ports & Adapters (siehe `CLEAN-ARCHITECTURE-REPORT.md`).
- Neuer Konfigurationsmechanismus (`--config`): `CONFIG_PATH` genügt.

## Decisions

1. **Argument-Parsing mit `node:util` `parseArgs`** statt commander/yargs: wenige Kommandos, keine neue Abhängigkeit. Kommandos sind eine Map `name → handler`, jeder Handler bekommt `{logger, config, args}`.
2. **Konfiguration nur über `CONFIG_PATH`.** Ein `--config`-Flag würde `env.ts` (wirft beim Import) umgehen müssen. Gleiches Verhalten wie die App reicht für den Containerbetrieb.
3. **`src/logging.ts`**: `configureLogging()` aus `main.ts` extrahiert (Sinks, Redaction, JSON in Produktion). Die CLI schreibt Ergebnisse als Logzeilen; für `validate-config` zusätzlich eine kurze Zusammenfassung auf stdout.
4. **`src/queues.ts`**: Factory für die drei Queues samt `defaultJobOptions` und Redis-Optionen. `main.ts` und CLI nutzen sie, damit `requeue` exakt wie der Startup-Scan einstellt. Alternative (Optionen in der CLI duplizieren) verworfen, weil sich die Werte sonst auseinanderentwickeln.
5. **`src/db.ts`**: `migrate(db)` exportieren, `openDatabase` ruft sie weiter auf. `migrate`-Kommando öffnet und migriert; `reset-*` nutzen `openDatabase` (Migration ist idempotent).
6. **Account-Auflösung** über `id` oder `name`, bei Mehrdeutigkeit (gleicher Name) Fehler.
7. **`reset-channel`** stoppt best-effort wie `DriveMonitor.start()` und löscht die Zeile; erneuert wird durch den Poller der laufenden App (`ChannelRenewalScheduler`: kein Zustand ⇒ fällig). Läuft keine App, wird der Channel beim nächsten Start angelegt.
8. **`requeue`** nutzt `collectOutstandingJobs(processors, "process-changes")` mit eigenen `FileProcessor`-Instanzen (ohne `FileStore.init`, da nur gelistet wird).
9. **`validate-config --online`**: Redis `PING` mit Timeout; Drive `files.get` auf Quell- und Zielordner; Paperless `GET {server_url}/api/documents/?page_size=1` mit Basic-Auth. Jede Prüfung hat ein Timeout (10 s) und läuft pro Account isoliert.
10. **Exit-Codes**: 0 Erfolg, 1 Laufzeitfehler, 2 Bedienfehler.

## Risks / Trade-offs

- **Race bei laufender App:** `reset-token` während eines Collect kann den Token direkt wieder überschreiben; `reset-channel` neben einem laufenden Renew kann kurz zwei Channels erzeugen (der alte wird beim nächsten Start gestoppt). Mitigation: Warnung in der CLI, Dokumentation. Kein Locking in dieser Change.
- **Datenverlust-Risiko bei `reset-token`:** Änderungen zwischen altem und neuem Token werden nicht nachverfolgt. Mitigation: Hinweis auf `requeue`, das alle Dateien im Quellordner einstellt.
- **Refactoring von `main.ts`** (Logging, Queues) ohne Tests. Mitigation: reine Extraktion ohne Verhaltensänderung, Prüfung per Build, Start gegen lokales docker-compose und Vergleich der Queue-Optionen.
