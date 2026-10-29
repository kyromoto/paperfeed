# Proposal

## Why

Wartungsaufgaben (Konfiguration prüfen, Migrationen ausführen, Change-Token oder Webhook-Channel zurücksetzen, Dateien erneut einstellen) sind heute nur durch Handarbeit an SQLite/Redis oder durch Neustart der App möglich. Das verletzt Faktor XII der Twelve-Factor-App (Admin-Prozesse als Einmal-Kommandos im selben Codebase/Image, siehe `12-FACTOR-REPORT.md`) und erschwert den Betrieb im Container.

## What Changes

- Neues Kommandozeilenprogramm `src/cli.ts` (gebaut nach `build/cli.js`) mit den Kommandos `validate-config`, `migrate`, `reset-token`, `reset-channel` und `requeue`.
- Neuer npm-Script `cli` für die lokale Entwicklung (`npm run cli -- <kommando>`).
- Migrationen in `src/db.ts` werden als eigene Funktion exportiert, damit `migrate` sie ohne App-Start ausführen kann. Das Verhalten beim App-Start bleibt unverändert.
- `ChangeTokenRepository` und `ChannelRepository` erhalten je eine `delete`-Methode.
- Logging-Konfiguration und Queue-Erzeugung werden aus `src/main.ts` in gemeinsam genutzte Module ausgelagert, damit CLI und App identische Einstellungen verwenden (Redaction, JSON-Format, Queue-Optionen).
- Dokumentation (README, `CLAUDE.md`) und `12-FACTOR-REPORT.md` (Faktor XII) werden aktualisiert.

Nicht Teil dieser Change: Bull-Board/Web-UI, `status`-Kommando, Interaktive Rückfragen, Prozesstypen-Trennung, Umbau auf Ports & Adapters.

## Capabilities

### New Capabilities
- `admin-cli`: Einmal-Kommandos zur Konfigurationsprüfung, Migration und Wartung von Change-Token, Webhook-Channel und Verarbeitungs-Queue.

### Modified Capabilities
<!-- Keine: Das Verhalten bestehender Capabilities ändert sich nicht, die CLI nutzt sie nur. -->

## Impact

- Neu: `src/cli.ts`, `src/logging.ts`, `src/queues.ts`.
- Geändert: `src/main.ts` (nutzt die ausgelagerten Module), `src/db.ts`, `src/change-token-repository.ts`, `src/channel-repository.ts`, `package.json` (Script).
- Keine neuen Abhängigkeiten (`node:util` `parseArgs`).
- Betrieb: Aufruf im Container via `node build/cli.js <kommando>` mit denselben Umgebungsvariablen und derselben Konfigurationsdatei wie die App. Die CLI kann parallel zur laufenden App laufen (SQLite im WAL-Modus).
