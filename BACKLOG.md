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

## Refactoring — Lesbarkeit `main.ts`

Zwei unabhängige Verbesserungen, können einzeln umgesetzt werden.

### 1. IIFE → benannte `main()`-Funktion
Anonymes `(async () => { ... })()` durch `async function main() { ... }` + `main()` ersetzen. Macht den Einstiegspunkt sofort erkennbar und erlaubt Top-Level-Typen außerhalb des Blocks.

### 2. `addExitCallback` ans Ende verschieben
Der Callback (Zeile 43) referenziert `logger`, `server`, `redisConnection`, `db`, `renewalSchedulerInterval` und `monitors`, die erst weiter unten deklariert werden (die letzten beiden kamen mit dem SQLite/Poller-Refactor dazu — das Problem wächst mit). Callback nach allen Deklarationen platzieren oder in eine `setupShutdownHandler(logger, server, redisConnection, db, renewalSchedulerInterval, monitors)`-Funktion auslagern.


---

# 12-Factor

Aufgaben aus [`12-FACTOR-REPORT.md`](12-FACTOR-REPORT.md). Beim Umsetzen eines Punkts den Report aktualisieren (Status, Ist-Zustand, Gesamtergebnis).

## Security — Webhook-Token verifizieren

**Eingriff:** Gering. Siehe `12-FACTOR-REPORT.md`, Weitere Befunde.

**Umsetzung:** In `src/drive-monitor.ts` beim `files.watch` ein zufälliges `token` setzen (pro Channel, in `drive_channels` persistieren) und in `src/controllers.ts` den Header `X-Goog-Channel-Token` gegen den gespeicherten Wert prüfen. Bei Abweichung ignorieren (200, wie bei unbekanntem Channel).

---

## Docs — README aktualisieren

**Eingriff:** Gering. Siehe `12-FACTOR-REPORT.md`, Weitere Befunde.

**Umsetzung:** Channel-Erneuerung als Poller (`ChannelRenewalScheduler`, `renewPollIntervalSec`) statt Delayed-Job beschreiben; `data_path` enthält SQLite-DB (`db/`) und Temp-Dateien (`files/`), nicht Change-Tokens; `queue`-Optionen (`concurrency`, `debounce`, `renewPollIntervalSec`) dokumentieren.

---

## Refactoring — Geordneter Shutdown (12-Factor IX)

**Eingriff:** Gering–Mittel. Siehe `12-FACTOR-REPORT.md`, Faktor IX.

**Umsetzung:** Shutdown in `src/main.ts` sequentiell und mit Gesamt-Timeout: HTTP-Server stoppen → Scheduler stoppen → `await worker.close()` für alle drei Worker (wartet auf aktive Jobs) → Monitors stoppen → Queues und Redis schließen → DB schließen.

**Hinweis:** Überschneidet sich mit „Refactoring — Lesbarkeit `main.ts`“ (Punkt 2, `setupShutdownHandler`). Beides zusammen umsetzen.

---

## Refactoring — Env-basierte Konfiguration (12-Factor III, IV, VII)

**Eingriff:** Mittel. Siehe `12-FACTOR-REPORT.md`, Faktoren III, IV, VII.

**Ziel:** Infrastruktur und Secrets aus Env-Variablen, YAML nur für die Account-Topologie.

**Umsetzung:**
- `src/env.ts`: optionale Variablen `PORT`, `REDIS_URL`, `REDIS_PREFIX`, `DATA_PATH`, `WEBHOOK_URL` sowie Secrets (Drive-Credentials, Paperless-Zugang)
- `src/config-repository.ts`: Env-Werte überschreiben YAML-Werte vor der Zod-Validierung (abwärtskompatibel)
- `src/types.ts`: betroffene `server.*`-Felder optional machen, Validierung nach dem Merge
- README und `config.example.yml` anpassen

---

## Feature — Admin-CLI (12-Factor XII)

**Eingriff:** Mittel. Siehe `12-FACTOR-REPORT.md`, Faktor XII.

**Umsetzung:** Neue `src/cli.ts` im selben Image mit Kommandos `migrate`, `reset-token <account>`, `reset-channel <account>`, `requeue <account>`, `validate-config`. Migrationen aus `openDatabase()` in `src/db.ts` in eine eigene Funktion auslagern (beim App-Start weiterhin aufgerufen).

**Hinweis:** Ergänzt das Bull-Board-Feature (Queue-Sicht) um Wartungsaktionen.

---

## Refactoring — Prozesstypen web / worker / scheduler (12-Factor VIII)

**Eingriff:** Mittel–Hoch. Siehe `12-FACTOR-REPORT.md`, Faktor VIII.

**Umsetzung:** `src/main.ts` nach Rolle aufteilen (Env `PROCESS_TYPE` oder Start-Argument). Scheduler als BullMQ-Repeatable-Job statt `setInterval`. FileStore-Pfade pro Job eindeutig machen, damit `process`-Concurrency > 1 möglich wird.

**Hinweis:** Setzt für echtes Scale-out den Stateless-Punkt voraus.

---

## Refactoring — Zustand nach Redis, stateless (12-Factor VI, IV)

**Eingriff:** Hoch. Siehe `12-FACTOR-REPORT.md`, Faktoren VI, IV.

**Nur umsetzen, wenn horizontale Skalierung nötig wird.** Single-Instance mit persistentem Volume ist vertretbar.

**Umsetzung:** `ChangeTokenRepository` und `ChannelRepository` auf Redis umstellen (Interface bleibt), `src/db.ts` und SQLite entfernen, Datenmigration aus Bestands-SQLite. `FileStore` durch Streaming Drive → Paperless ersetzen oder geteilten Storage nutzen. Webhook-Zuordnung `channelId → account` aus dem geteilten Store statt aus In-Memory-Maps.
