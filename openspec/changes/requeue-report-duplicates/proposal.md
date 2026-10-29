# Proposal

## Why

`requeue` meldet `<account>: N file(s) queued for processing`, wobei N die Zahl der Dateien im Quellordner ist, nicht die Zahl der tatsächlich neu angelegten Jobs. Läuft für eine Datei bereits ein Job, legt BullMQ wegen der Deduplizierung keinen zweiten an, die Meldung zählt die Datei trotzdem mit. Beim manuellen Test des Erfolgsfalls (zweiter und dritter Aufruf) war das irreführend: Die Meldung sagt „1 file(s) queued“, in der Queue liegt aber weiterhin genau ein Job. Die Zahl lässt sich nur in Redis oder Bull Board prüfen.

## What Changes

- `requeue` meldet getrennt, wie viele Jobs neu angelegt wurden und wie viele Dateien bereits in der Queue standen, z. B. `dev: 2 file(s) queued, 1 already queued`. Ohne Dateien im Quellordner lautet die Meldung `dev: no files in the source folder`. Der Exit-Code bleibt in allen Fällen 0.
- Die Unterscheidung kommt aus der Antwort von `Queue.addBulk`: Für eine deduplizierte Datei liefert BullMQ den **bereits vorhandenen** Job zurück, dessen `id` von der angeforderten `jobId` abweicht. Das ist gegen BullMQ 5.78 mit echtem Redis geprüft (Probe: zweiter `addBulk` mit denselben Dedup-IDs lieferte die ids der ersten Jobs, ein neuer Eintrag bekam seine eigene id, in der Queue lagen danach genau die erwarteten Jobs).
- Neue Funktion `enqueueJobs(queue, jobs)` in `src/queue-utils.ts` mit Rückgabe `{ created, alreadyQueued }`, von `requeue` verwendet.
- Tests für `enqueueJobs` und für die Job-Schemata von `collectOutstandingJobs` (jobId- und Dedup-ID-Format).

Nicht Teil dieser Change: der Startup-Scan in `main.ts` (loggt weiter „Queue N outstanding files“), die Job-Schemata selbst, das Verhalten der Deduplizierung.

## Capabilities

### New Capabilities
<!-- Keine -->

### Modified Capabilities
- `admin-cli`: Ausgabe von `requeue` unterscheidet neu angelegte und bereits vorhandene Jobs.

## Impact

- Geändert: `src/cli.ts` (`requeue`), `src/queue-utils.ts` (neue Funktion), README (Beschreibung des Kommandos).
- Neu: `src/queue-utils.test.ts`.
- Keine neuen Abhängigkeiten, keine Änderung an Queue-Optionen oder Job-Schemata. Release als `fix:` (Patch), weil die bisherige Meldung falsche Zahlen nannte.
- Wer die Ausgabe von `requeue` automatisiert auswertet, muss das neue Format beachten (bisher: `N file(s) queued for processing`).
