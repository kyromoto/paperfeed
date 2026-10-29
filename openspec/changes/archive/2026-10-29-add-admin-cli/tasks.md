# Tasks

## 1. Gemeinsame Bausteine extrahieren

- [x] 1.1 `src/logging.ts` mit `configureLogging()` aus `main.ts` auslagern (Sinks, Redaction, JSON in Produktion), `main.ts` nutzt sie
- [x] 1.2 `src/queues.ts` mit Factory für `collect-changes`, `process-changes`, `renew-channel` (inkl. `defaultJobOptions`) und Redis-Optionen auslagern, `main.ts` nutzt sie
- [x] 1.3 `src/db.ts`: `migrate(db)` exportieren, `openDatabase` ruft sie weiter auf
- [x] 1.4 `ChangeTokenRepository.delete(accountId, folderId)` und `ChannelRepository.delete(accountId)` ergänzen, jeweils mit Rückgabe, ob eine Zeile gelöscht wurde

## 2. CLI-Grundgerüst

- [x] 2.1 `src/cli.ts` mit `parseArgs`, Kommando-Map, Hilfe, Exit-Codes (0/1/2) und Account-Auflösung (id oder name)
- [x] 2.2 `npm run cli`-Script in `package.json`, Aufrufbeispiele in der Hilfe
- [x] 2.3 Einheitliches Schließen von SQLite, Redis und Queues am Ende jedes Kommandos (auch bei Fehlern)

## 3. Kommandos

- [x] 3.1 `validate-config`: Zod-Parse, Querverweise, Eindeutigkeit der IDs, keine Secrets in der Ausgabe
- [x] 3.2 `validate-config --online`: Redis-Ping, Drive-Ordnerzugriff (Quelle und Ziel), Paperless-Login, Timeout 10 s, Fehler pro Account isoliert
- [x] 3.3 `migrate`: nur SQLite, kein Redis
- [x] 3.4 `reset-token <account>` mit Warnung und Hinweis auf `requeue`
- [x] 3.5 `reset-channel <account>`: `channels.stop` best-effort, Zeile löschen, Hinweis auf Poller
- [x] 3.6 `requeue <account>`: `FileProcessor` je Account, `collectOutstandingJobs`, `addBulk`, Anzahl ausgeben

## 4. Prüfung

- [x] 4.1 `npx tsc --noEmit`, `npx biome ci src`, `npm run build`
- [x] 4.2 `validate-config` gegen `config/config.yml` (Exit 0) und eine absichtlich kaputte Kopie (Exit 1), `--online` gegen lokales docker-compose
- [x] 4.3 `migrate` auf leerem `data_path`, zweiter Lauf idempotent
- [x] 4.4 `reset-token`, `reset-channel`, `requeue` gegen laufende App und docker-compose: Zeile verschwindet, Poller legt Channel neu an, Jobs ohne Duplikate (Erfolgsfall von `requeue` mit Dateien im Quellordner zunächst nicht getestet; nachträglich am 2026-10-29 manuell end-to-end geprüft, Verhalten wie erwartet)
- [x] 4.5 Regression: App startet unverändert (Logformat, Queue-Optionen, Shutdown)

## 5. Dokumentation und Abschluss

- [x] 5.1 README: Abschnitt „Admin CLI“ mit Kommandos und Docker-Aufruf (`docker run … node build/cli.js …`)
- [x] 5.2 `CLAUDE.md`: Key components (`cli.ts`, `logging.ts`, `queues.ts`), OpenSpec-Hinweis
- [x] 5.3 `12-FACTOR-REPORT.md`: Faktor XII auf ✅, Gesamtergebnis und Reihenfolge aktualisieren; Backlog-Eintrag „Admin-CLI“ entfernen
- [ ] 5.4 Change archivieren (`openspec archive add-admin-cli`), Specs in die Baseline übernehmen
