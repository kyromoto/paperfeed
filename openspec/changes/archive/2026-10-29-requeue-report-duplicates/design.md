# Design

## Context

- `requeue` baut die Jobs mit `collectOutstandingJobs` (`src/queue-utils.ts`) und stellt sie mit `processChangesQueue.addBulk(jobs)` ein. Die Meldung gibt `jobs.length` aus.
- Jobs tragen `opts.jobId = process-changes-<account>-<file>-<Zeitstempel>` und `opts.deduplication.id = process-changes-<account>-<file>`. Bei laufendem oder wartendem Job mit gleicher Dedup-ID legt BullMQ keinen neuen an.
- Probe gegen BullMQ 5.78 und Redis 7 (einmalig, Scratch-Skript, eigene Redis-DB): `addBulk([a, b])` liefert die ids der neuen Jobs; ein zweiter `addBulk([a', b', c'])` mit gleichen Dedup-IDs liefert `[Job a, Job b, Job c']`, wobei a und b die **ids der ersten Jobs** tragen, c' seine eigene. Die Queue enthält danach genau drei Jobs. Ein `deduplicated`-Ereignis gibt es nur über `QueueEvents`, nicht über die `Queue`.

## Goals / Non-Goals

**Goals:**
- Die Meldung nennt die tatsächlich neu angelegten Jobs und die bereits vorhandenen getrennt.
- Die Logik ist ohne Redis testbar.

**Non-Goals:**
- Änderungen an Job-Schemata, Queue-Optionen, am Startup-Scan oder an der Deduplizierung.

## Decisions

1. **Erkennung über die id:** Für Eintrag *i* gilt: `returned[i].id !== requested[i].opts.jobId` bedeutet „bereits vorhanden“. Die Reihenfolge von `addBulk` entspricht der Eingabe. Alternative `QueueEvents`-Abonnement (`deduplicated`) verworfen: braucht eine zweite Redis-Verbindung und Wartezeit auf Ereignisse. Alternative vorheriges Abfragen der Dedup-Schlüssel verworfen: Race zwischen Prüfung und Einstellen.
2. **Eigene Funktion `enqueueJobs(queue, jobs)`** in `src/queue-utils.ts`, Rückgabe `{ created, alreadyQueued }`. Bei leerer Liste wird `addBulk` nicht aufgerufen. Die Funktion nimmt nur ein Objekt mit `addBulk`, damit sie mit einer Fake-Queue testbar ist.
3. **Ausgabeformat (Englisch, wie die übrigen Meldungen):** `<account>: <created> file(s) queued, <alreadyQueued> already queued`; ohne Dateien `<account>: no files in the source folder`. Exit-Code immer 0.
4. **Startup-Scan unverändert:** `main.ts` ruft weiter `addBulk` direkt auf. Eine gemeinsame Nutzung von `enqueueJobs` wäre möglich, ist aber eine Verhaltensänderung der App (Logzeile) und bleibt einer eigenen Change vorbehalten.
5. **Tests:** `enqueueJobs` mit Fake-Queue (alle neu, alle vorhanden, gemischt, leer, Reihenfolge) und `collectOutstandingJobs` mit Fake-Prozessor (jobId- und Dedup-ID-Schema, Name, Daten). Zusätzlich einmalige Prüfung gegen echtes BullMQ/Redis (nicht eingecheckt), weil die Erkennung vom Bibliotheksverhalten abhängt.

## Risks / Trade-offs

- **Abhängigkeit vom Bibliotheksverhalten:** Ändert sich in einer künftigen BullMQ-Version, was `addBulk` für deduplizierte Einträge zurückgibt, würde die Zählung falsch (alles „neu“ oder alles „vorhanden“). Mitigation: Prüfskript gegen echtes Redis in den Tasks, Hinweis im Code, Test des Schemas; bei einem BullMQ-Upgrade wiederholen.
- **Automatisierte Auswertung der alten Meldung:** Das Format ändert sich. Mitigation: Hinweis in der Proposal, Release als Patch ist vertretbar, weil die alte Zahl falsch war.
