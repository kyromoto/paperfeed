# Backlog

## Entfallen — Admin Web UI (Bull Board)

Wird nicht im Backend umgesetzt. Bull Board läuft als **separater Container** (`venatum/bull-board`, siehe `docker-compose.example.yml`) und bleibt im internen Docker-Netz. Gründe: keine unauthentifizierte Admin-UI auf dem öffentlich erreichbaren Webhook-Port, keine zusätzlichen Abhängigkeiten in der App, unabhängige Updates. Der Queue-Prefix (`SERVER_QUEUE_REDIS_PREFIX`, Default `paperless-gdrive-link`) muss `BULL_PREFIX` des Containers entsprechen; `renew-channel` ist dort neben `collect-changes` und `process-changes` sichtbar. Hinweise für den Betrieb stehen im README.

---

# 12-Factor

Aufgaben aus [`12-FACTOR-REPORT.md`](12-FACTOR-REPORT.md). Beim Umsetzen eines Punkts den Report aktualisieren (Status, Ist-Zustand, Gesamtergebnis).

## Refactoring — Prozesstypen web / worker / scheduler (12-Factor VIII)

**Eingriff:** Mittel–Hoch. Siehe `12-FACTOR-REPORT.md`, Faktor VIII.

**Umsetzung:** `src/main.ts` nach Rolle aufteilen (Env `PROCESS_TYPE` oder Start-Argument). Scheduler als BullMQ-Repeatable-Job statt `setInterval`. FileStore-Pfade pro Job eindeutig machen, damit `process`-Concurrency > 1 möglich wird.

**Hinweis:** Setzt für echtes Scale-out den Stateless-Punkt voraus (siehe „Feature — Multi-Instanz-Betrieb“). `setupShutdownHandler` (`src/shutdown.ts`) muss dann pro Prozesstyp nur die jeweils laufenden Ressourcen schließen.

---

## Refactoring — Zustand nach Redis, stateless (12-Factor VI, IV)

**Eingriff:** Hoch. Siehe `12-FACTOR-REPORT.md`, Faktoren VI, IV.

**Nur umsetzen, wenn horizontale Skalierung nötig wird.** Single-Instance mit persistentem Volume ist vertretbar. Gesamtbild und weitere Blocker siehe „Feature — Multi-Instanz-Betrieb“.

**Umsetzung:** `ChangeTokenRepository` und `ChannelRepository` auf Redis umstellen (Interface bleibt), `src/db.ts` und SQLite entfernen, Datenmigration aus Bestands-SQLite. `FileStore` durch Streaming Drive → Paperless ersetzen oder geteilten Storage nutzen. Webhook-Zuordnung `channelId → account` und das Channel-Token (`X-Goog-Channel-Token`, aktuell nur in `DriveMonitor` im Speicher) aus dem geteilten Store statt aus In-Memory-Maps.

---

## Refactoring — Ports & Adapters, inkrementell

**Eingriff:** Mittel bis Hoch, in Etappen. Siehe `CLEAN-ARCHITECTURE-REPORT.md`.

**Ziel:** Pragmatische Clean Architecture (Ports & Adapters light): Use-Cases ohne SDK-/Queue-/HTTP-Abhängigkeiten, Adapter für Drive, Paperless, SQLite, BullMQ, Express. Erstmals testbar.

**Umsetzung (Reihenfolge laut Report, Abschnitt 6):**
1. Ports + `process-file`-Use-Case; die Charakterisierungstests für Zustandsmaschine, Webhook, Scheduler und Shutdown existieren bereits, es fehlen `FileProcessor` und `lib.ts` (Drive-/Paperless-SDK, Dateipuffer), die erst mit den Ports sinnvoll testbar werden
2. `handle-webhook`- und `collect-changes`-Use-Case, jobId-Schemata zentralisieren
3. Persistence-Ports zusammen mit Env-Konfiguration bzw. Redis-Umzug
4. Prozesstypen; die Admin-CLI (`src/cli.ts`) wird dabei zu einem weiteren Eingangsadapter
5. Verzeichnisstruktur zuletzt

**Hinweis:** Verbilligt die 12-Factor-Punkte IV, VI, VIII, XII; deshalb vor oder zusammen mit diesen Einträgen umsetzen. Nicht als Big Bang.

---

## Feature — Multi-Instanz-Betrieb

**Status:** zurückgestellt, nur bei echtem Bedarf (Verteilung oder Updates ohne Unterbrechung). Die App unterstützt heute ausdrücklich nur **eine** Instanz (siehe README). Einordnung: Auf einem einzelnen Docker-Host bringt eine zweite Instanz kaum Durchsatz (Drive und Paperless begrenzen, `process-changes` läuft bewusst mit Concurrency 1); ein kurzer Stopp/Start reicht für Updates, verpasste Benachrichtigungen holt der Startup-Scan nach.

**Eingriff:** Hoch. Fasst die Einträge „Prozesstypen“ und „Zustand nach Redis“ zusammen und ergänzt, was dort noch fehlt.

**Blocker im aktuellen Code:**
1. **Webhook-Zuordnung und Channel-Token nur im Speicher:** `handleWebhook` findet den Account über `monitor.getChannelId()`, das Token (`verifyChannelToken`) liegt nur im `DriveMonitor` der Instanz, die den Channel angelegt hat. Eine andere Instanz kennt den Channel nicht und ignoriert den Webhook (Antwort 200).
2. **Channel-Besitz:** Jede Instanz legt in `DriveMonitor.start()` eigene Channels an und stoppt dabei den persistierten (fremden) Channel; `stop()` beim Herunterfahren beendet den gemeinsamen Channel und schaltet die Webhooks aller Instanzen ab (Rolling Update).
3. **Scheduler in jeder Instanz:** Die Deduplizierung der `renew-channel`-Jobs verhindert Doppelungen, der Job läuft aber in irgendeinem Worker-Prozess, der Channel und Token dann nur lokal hält.
4. **Lokaler Dateipuffer:** Landet ein Retry nach dem Schritt „downloaded“ auf einer anderen Instanz, fehlt die Datei unter `{data_path}/files` und der Upload scheitert.
5. **Keine Sperre pro Account für `collect-changes`:** Zwei Jobs desselben Accounts können den Change-Token gleichzeitig fortschreiben (heute schon mit Concurrency 5 möglich).
6. **Doppelverarbeitung bei Absturz:** Ein hängender Job wird neu zugestellt und kann dieselbe Datei erneut hochladen.

**Umsetzung (grobe Reihenfolge):**
1. ~~Tests für Zustandsmaschine, Webhook, Scheduler und Shutdown~~ (erledigt: `queue-processor`, `controllers`, `channel-renewal-scheduler`, `shutdown`, `drive-monitor`; offen bleiben `FileProcessor` und `lib.ts`)
2. Channel-Zustand inklusive Token und Change-Token nach Redis, hinter den bestehenden Repository-Schnittstellen (`ChannelRepository`, `ChangeTokenRepository`); Webhook prüft gegen den gemeinsamen Zustand
3. Channel-Besitz klären: genau ein Prozess erzeugt, erneuert und stoppt Channels, entweder fester Prozesstyp `scheduler` (siehe „Prozesstypen“) oder Leader per Redis-Lock mit Ablauf; `web` und `worker` stoppen beim Herunterfahren keine Channels
4. Dateipuffer entfernen: Download und Upload in einem Schritt streamen (Retry läuft komplett von vorn; Paperless lehnt Duplikate in der Regel am Inhalt ab) oder auf einem Host ein geteiltes Volume nutzen
5. Sperre pro Account für `collect-changes` (Redis-Lock oder Concurrency 1)
6. Idempotenz der Verarbeitung prüfen (Doppel-Upload nach Neuzustellung)

**Hinweis zu SQLite:** Mehrere Container auf **einem** Host mit gemeinsamem lokalen Volume funktionieren im WAL-Modus (die Admin-CLI neben der App nutzt das bereits). Über mehrere Hosts oder ein Netzwerkdateisystem (NFS/SMB) ist SQLite nicht geeignet; als gemeinsamer Zustand bietet sich das vorhandene Redis an. Redis ohne Persistenz wäre vertretbar (verlorener Change-Token wird neu geholt, `requeue` bzw. der Startup-Scan holen Verpasstes nach).

