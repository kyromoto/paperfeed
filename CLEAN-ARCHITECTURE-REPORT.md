# Report: Pragmatische Clean Architecture für paperfeed

Bewertung einer Umstellung auf eine pragmatische Variante der Clean Architecture (Ports & Adapters light) und ihrer Wirkung auf die zwölf Faktoren (siehe [`12-FACTOR-REPORT.md`](12-FACTOR-REPORT.md)).

- **Stand:** v1.8.2 + Folge-Commits, 2026-10-29
- **Pflege:** Bei struktureller Änderung der Codebasis oder Umsetzung des Backlog-Eintrags „Ports & Adapters“ (siehe [`BACKLOG.md`](BACKLOG.md)) aktualisieren.
- **Eingriff:** **Gering** = unter 1 h, 1–2 Dateien. **Mittel** = Stunden, 3–6 Dateien. **Hoch** = Architektur- oder Datenmodell-Umbau.

## Kurzfazit

- Die Umstellung ist machbar (~1,5–3 Personentage, kein Verhalten ändern), aber **kein Selbstzweck**: Sie behebt keinen 12-Factor-Mangel von allein, macht aber die offenen Punkte **IV, VI, VIII, XII** deutlich günstiger und schafft erstmals Testbarkeit (es gibt keine Tests).
- **Empfehlung:** Variante B (Ports & Adapters light), **inkrementell** und gekoppelt an die 12-Factor-Backlog-Punkte, nicht als Big Bang. Für reinen Single-Instance-Betrieb ohne weitere Features reicht Variante A (gezielte Refactorings).

## 1. Ist-Architektur

17 Dateien, ~1400 Zeilen, flaches `src/`, keine Tests. Die Schichten sind vermischt:

| Datei | Befund |
|---|---|
| `file-processor.ts` | Geschäftsablauf, Google-Drive-SDK (`drive_v3`), Paperless-HTTP (`axios`, `FormData`), `FileStore` und Config-Lookup in einer Klasse. `DriveFile` und die Job-Payload-Typen (`*JobPayload`, BullMQ-Kontext) liegen ebenfalls dort. |
| `queue-processor.ts` | Soll ein dünner Adapter sein, enthält aber die Zustandsmaschine des Prozess-Use-Cases (`downloaded → uploaded → moved → done`). |
| `controllers.ts` | HTTP-Adapter trifft Fachentscheidungen: Account-Zuordnung, Token-Prüfung, Debounce, jobId-Schema. |
| `drive-monitor.ts`, `lib.ts` | Drive-SDK, Persistenz, Channel-Token-Zustand und Legacy-Migration vermischt. `ChannelRepository`/`ChangeTokenRepository` sind konkrete, synchrone `better-sqlite3`-Klassen. Nur `ConfigRepository` ist ein Interface. |
| `main.ts` (~290 Zeilen) | Composition Root, Queue-Setup, Startup-Scan und Wiring in einem Block. |
| `types.ts` | Die Zod-Config dient zugleich als Domänenmodell. Use-Cases bekommen die komplette `Config` inkl. Secrets. |
| jobId-Schemata | An vier Stellen verteilt: `main.ts`, `controllers.ts`, `queue-utils.ts`, `channel-renewal-scheduler.ts` (das `process-changes`-Schema doppelt in `main.ts` und `queue-utils.ts`). |

**Nebenbefund (Doku-Drift):** `CLAUDE.md` beschreibt deterministische jobIds (`collect-changes-{accountId}`, `process-changes-{accountId}-{fileId}`). Der Code verwendet jobIds mit Zeitstempel plus `deduplication.id`. Korrigiert in `CLAUDE.md` und `app-sequence.mermaid`.

## 2. Zielbild (pragmatisch)

```
src/
  domain/        DriveFile, ProcessStep, Account-Typen (rein, keine Lib-Imports)
  application/   ports.ts: DriveGateway, PaperlessGateway, FileBuffer,
                 ChangeTokenStore, ChannelStore, JobQueue
                 Use-Cases: collect-changes, process-file (Zustandsmaschine),
                 renew-channel, handle-webhook, scan-outstanding
  adapters/      drive/ (Google SDK, Channel-Monitor), paperless/, persistence/ (SQLite),
                 file-store/, queue/ (BullMQ, jobId-Schemata zentral),
                 http/ (Express), config/ (YAML + Zod)
  main.ts        Composition Root (manuelle Dependency Injection, kein Container)
```

Regeln, damit es pragmatisch bleibt:
- Ports als Interfaces beim Konsumenten (`application/`), nicht pro Klasse.
- Keine Entity-/Value-Object-/Mapper-Schicht, wo Typen identisch sind.
- Zod-Config bleibt. Use-Cases erhalten nur den Ausschnitt, den sie brauchen.
- BullMQ bleibt in den Adaptern. Use-Cases geben Werte zurück, Fortschritt (`job.updateData`) läuft über einen Callback.
- Dateien mit `git mv` verschieben, um die Historie zu erhalten.

## 3. Aufwand je Baustein

| Baustein | Inhalt | Eingriff |
|---|---|---|
| Ports + Domain-Typen | Interfaces anlegen, `DriveFile`/`ProcessStep` verschieben | Gering |
| Drive-/Paperless-Gateway | Aus `file-processor.ts` und `lib.ts` extrahieren | Mittel |
| Use-Cases | Zustandsmaschine, Collect, Renew, Webhook-Entscheid, Startup-Scan | Mittel |
| Persistence-Ports | Repositories hinter async-Interfaces (sync → async) | Mittel |
| Queue-/HTTP-Adapter | Dünn machen, jobId-Schemata zentralisieren | Mittel |
| Composition Root, Verzeichnisse | `main.ts` aufteilen, Dateien verschieben | Gering–Mittel |
| Tests | Use-Case-Tests mit Fakes | Mittel (neu) |

Gesamt: etwa 60 % des Codes werden verschoben oder umgeschrieben.

## 4. Risiken

- **Keine Tests:** Regressionsrisiko beim Umbau. Die Invarianten aus `CLAUDE.md` (Deduplizierung, `process`-Concurrency 1, Step-Resume nach Retry, Channel-Lebenszyklus) müssen erhalten bleiben.
- **Gegenmaßnahme:** Zuerst Charakterisierungstests schreiben, dann umbauen. Für Zustandsmaschine (`queue-processor`), Webhook-Entscheid (`controllers`), Channel-Erneuerung, Shutdown und `DriveMonitor` sind sie vorhanden (104 Tests). Es fehlen `FileProcessor` und `lib.ts`, deren Tests ohne Ports nur über `vi.mock` von `axios` und `./lib` möglich wären.
- **Indirektion:** Bei ~1400 Zeilen ist der zusätzliche Boilerplate spürbar, der Nutzen entsteht erst mit Tests oder Austauschbarkeit.

## 5. Auswirkung auf die 12 Faktoren

Clean Architecture behebt keinen Faktor allein, sie senkt die Kosten der Backlog-Punkte.

| Faktor | Effekt | Begründung | Backlog-Aufwand vorher → nachher |
|---|---|---|---|
| III Konfiguration | mittel | Env-Merge nur im Config-Adapter, Use-Cases sehen keine Secrets | Mittel → Mittel (sauberer) |
| IV Backing Services | **stark** | Persistenz, Dateipuffer und Queue hinter Ports: Wechsel SQLite → Redis betrifft einen Adapter | Hoch → Mittel–Hoch |
| VI Prozesse (stateless) | **stark** | Zustand (Token, Channel, Dateipuffer) austauschbar, Channel-Token nicht mehr im Monitor-Objekt | Hoch → Mittel–Hoch |
| VIII Nebenläufigkeit | **stark** | `web`/`worker`/`scheduler` komponieren nur die benötigten Adapter | Mittel–Hoch → Mittel |
| IX Disposability | mittel | Jeder Adapter bietet `close()`, `shutdown.ts` bekommt eine Liste statt Einzelressourcen | erledigt, vereinfacht Pflege |
| XII Admin-Prozesse | war stark | Inzwischen ohne Umbau umgesetzt (`src/cli.ts`), Ports würden sie nur sauberer testbar machen | erledigt |
| X Dev/Prod-Parität | gering | In-Memory-Fakes für Dev und Tests | – |
| I, II, V, VII, XI | neutral | – | – |

Negative Effekte gibt es nicht, außer dem anfänglichen Aufwand und der zusätzlichen Indirektion.

## 6. Varianten und Empfehlung

| Variante | Bewertung |
|---|---|
| A) Status quo + gezielte Refactorings | Günstig, Testbarkeit und Austauschbarkeit bleiben schlecht. Ausreichend, wenn nur Single-Instance-Betrieb ohne neue Features geplant ist. |
| **B) Ports & Adapters light, inkrementell** | **Empfohlen.** Nicht als Big Bang, sondern gekoppelt an die 12-Factor-Punkte. |
| C) Volle Clean Architecture (Entities, Value Objects, DI-Container) | Für diese Größe Overkill, nicht empfohlen. |

**Empfohlene Reihenfolge für B:**
1. Ports + `process-file`-Use-Case (Zustandsmaschine) inkl. Charakterisierungstests.
2. `handle-webhook`- und `collect-changes`-Use-Case, jobId-Schemata zentralisieren.
3. Persistence-Ports zusammen mit Env-Konfiguration (III) bzw. dem Redis-Umzug (VI).
4. Admin-CLI (XII) als zweiter Eingangsadapter, Prozesstypen (VIII).
5. Verzeichnisstruktur zuletzt (`git mv`).
