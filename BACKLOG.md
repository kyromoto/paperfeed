# Backlog

## Feature — Admin Web UI (Bull Board)

**Ziel:** Einfache, auth-freie Admin-Oberfläche unter `/admin/queues`, auf der aktive, wartende, abgeschlossene und fehlgeschlagene Jobs aller drei Queues sichtbar sind.

**Umsetzung:**
- Pakete `@bull-board/express` und `@bull-board/api` installieren
- `ExpressAdapter` + `createBullBoard` in `src/main.ts` einbinden, Queue-Instanzen (`collect-changes`, `process-changes`, `renew-channel`) als `BullMQAdapter` registrieren
- Router unter `/admin/queues` mounten (vor anderen Routes)
- Queue-Instanzen ggf. aus dem lokalen Scope herauslösen, damit sie dem Board-Setup zugänglich sind

**Hinweis:** `renew-channel` unbedingt mit aufnehmen — seit dem SQLite/Poller-Refactor der Channel-Renewal-Logik (siehe CLAUDE.md) ist Bull Board dort der einzige Weg, Retries/fehlgeschlagene Renewals zu beobachten.

**Hinweis:** Kein Auth vorgesehen — nur für internes/lokales Deployment gedacht.

---

## Feature — Matrix-Benachrichtigung bei finalem Job-Fehler

**Ziel:** Wenn ein BullMQ-Job alle Retry-Versuche ausgeschöpft hat und final fehlschlägt, wird eine Nachricht an einen konfigurierten Matrix-Raum gesendet.

**Umsetzung (4 Dateien):**

1. **`src/types.ts`** — Optionalen `notifications.matrix`-Block zum `Server`-Zod-Schema hinzufügen:
   - `homeserver_url`, `access_token`, `room_id`

2. **`src/matrix-notifier.ts`** — Neue Datei (~30 Zeilen). Thin wrapper um die Matrix CS API (`PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}`), nutzt `axios`.

3. **`src/queue-utils.ts`** — `attachWorkerLogging` um optionalen 6. Parameter `onFinalFailure` erweitern. Finale Fehler erkennen via `job.attemptsMade >= (job.opts.attempts ?? 1)`. Im bestehenden `failed`-Handler aufrufen.

4. **`src/main.ts`** — `MatrixNotifier` instanziieren (falls konfiguriert), als `onFinalFailure`-Callback an alle drei `attachWorkerLogging`-Aufrufe übergeben.

**Nachrichtenformat:**
```
[paperfeed] Job final fehlgeschlagen
Queue: process-changes
Job: invoice.pdf (account: personal)
Fehler: HTTP 500 from Paperless
Versuche: 3/3
```

**Hinweis:** Credentials im YAML (konsistent mit Drive/Paperless). Plain `axios` statt Matrix SDK — für ein einziges `send` nicht nötig.

---

# 12-Factor

Aufgaben aus [`12-FACTOR-REPORT.md`](12-FACTOR-REPORT.md). Beim Umsetzen eines Punkts den Report aktualisieren (Status, Ist-Zustand, Gesamtergebnis).

## Refactoring — Env-basierte Konfiguration (12-Factor III, IV, VII)

**Eingriff:** Mittel. Siehe `12-FACTOR-REPORT.md`, Faktoren III, IV, VII.

**Ziel:** Infrastruktur und Secrets aus Env-Variablen, YAML nur für die Account-Topologie.

**Umsetzung:**
- `src/env.ts`: optionale Variablen `PORT`, `REDIS_URL`, `REDIS_PREFIX`, `DATA_PATH`, `WEBHOOK_URL` sowie Secrets (Drive-Credentials, Paperless-Zugang)
- `src/config-repository.ts`: Env-Werte überschreiben YAML-Werte vor der Zod-Validierung (abwärtskompatibel)
- `src/types.ts`: betroffene `server.*`-Felder optional machen, Validierung nach dem Merge
- README und `config.example.yml` anpassen

---

## Refactoring — Prozesstypen web / worker / scheduler (12-Factor VIII)

**Eingriff:** Mittel–Hoch. Siehe `12-FACTOR-REPORT.md`, Faktor VIII.

**Umsetzung:** `src/main.ts` nach Rolle aufteilen (Env `PROCESS_TYPE` oder Start-Argument). Scheduler als BullMQ-Repeatable-Job statt `setInterval`. FileStore-Pfade pro Job eindeutig machen, damit `process`-Concurrency > 1 möglich wird.

**Hinweis:** Setzt für echtes Scale-out den Stateless-Punkt voraus. `setupShutdownHandler` (`src/shutdown.ts`) muss dann pro Prozesstyp nur die jeweils laufenden Ressourcen schließen.

---

## Refactoring — Zustand nach Redis, stateless (12-Factor VI, IV)

**Eingriff:** Hoch. Siehe `12-FACTOR-REPORT.md`, Faktoren VI, IV.

**Nur umsetzen, wenn horizontale Skalierung nötig wird.** Single-Instance mit persistentem Volume ist vertretbar.

**Umsetzung:** `ChangeTokenRepository` und `ChannelRepository` auf Redis umstellen (Interface bleibt), `src/db.ts` und SQLite entfernen, Datenmigration aus Bestands-SQLite. `FileStore` durch Streaming Drive → Paperless ersetzen oder geteilten Storage nutzen. Webhook-Zuordnung `channelId → account` und das Channel-Token (`X-Goog-Channel-Token`, aktuell nur in `DriveMonitor` im Speicher) aus dem geteilten Store statt aus In-Memory-Maps.

---

## Refactoring — Ports & Adapters, inkrementell

**Eingriff:** Mittel bis Hoch, in Etappen. Siehe `CLEAN-ARCHITECTURE-REPORT.md`.

**Ziel:** Pragmatische Clean Architecture (Ports & Adapters light): Use-Cases ohne SDK-/Queue-/HTTP-Abhängigkeiten, Adapter für Drive, Paperless, SQLite, BullMQ, Express. Erstmals testbar.

**Umsetzung (Reihenfolge laut Report, Abschnitt 6):**
1. Ports + `process-file`-Use-Case mit Charakterisierungstests
2. `handle-webhook`- und `collect-changes`-Use-Case, jobId-Schemata zentralisieren
3. Persistence-Ports zusammen mit Env-Konfiguration bzw. Redis-Umzug
4. Prozesstypen; die Admin-CLI (`src/cli.ts`) wird dabei zu einem weiteren Eingangsadapter
5. Verzeichnisstruktur zuletzt

**Hinweis:** Verbilligt die 12-Factor-Punkte IV, VI, VIII, XII; deshalb vor oder zusammen mit diesen Einträgen umsetzen. Nicht als Big Bang.
