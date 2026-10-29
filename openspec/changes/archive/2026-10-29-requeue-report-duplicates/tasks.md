# Tasks

## 1. Umsetzung

- [x] 1.1 `enqueueJobs(queue, jobs)` in `src/queue-utils.ts`: `addBulk` nur bei nicht leerer Liste, Vergleich von zurückgegebener id und angeforderter `jobId`, Rückgabe `{ created, alreadyQueued }`
- [x] 1.2 `requeue` in `src/cli.ts` nutzt `enqueueJobs` und gibt `<account>: <created> file(s) queued, <alreadyQueued> already queued` bzw. `<account>: no files in the source folder` aus

## 2. Tests

- [x] 2.1 `src/queue-utils.test.ts`: `enqueueJobs` mit Fake-Queue (alle neu, alle vorhanden, gemischt, leere Liste ruft `addBulk` nicht auf, Reihenfolge bleibt erhalten)
- [x] 2.2 `collectOutstandingJobs` mit Fake-Prozessor: Jobname, Daten, `jobId`-Schema und Dedup-ID-Schema je Datei, mehrere Accounts

## 3. Prüfung

- [x] 3.1 `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec biome ci src`, `pnpm run build`
- [x] 3.2 Einmalig gegen echtes BullMQ und Redis (Scratch-Skript, eigene Redis-DB): Ausgabe von `enqueueJobs` beim ersten, zweiten und gemischten Aufruf stimmt mit der Zahl der Jobs in der Queue überein
- [x] 3.3 Manuell mit `requeue` gegen Drive und Redis (Testdatei im Quellordner): erster Aufruf `1 file(s) queued, 0 already queued`, zweiter `0 file(s) queued, 1 already queued`, leerer Ordner `no files in the source folder` (am 2026-10-29 manuell geprüft: Fälle B1–B6 und leerer Ordner wie erwartet)

## 4. Dokumentation und Abschluss

- [x] 4.1 README: Beschreibung von `requeue` um die Ausgabe ergänzen
- [ ] 4.2 Change archivieren (`openspec archive requeue-report-duplicates`), Commit als `fix:`
