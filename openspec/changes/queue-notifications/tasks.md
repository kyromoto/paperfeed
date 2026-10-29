# Tasks

## 1. Queue und Prozessor

- [ ] 1.1 `src/queues.ts`: `NOTIFICATIONS_QUEUE` und vierte Queue `notificationsQueue` mit `attempts: 6`, exponentiellem Backoff ab 30 s, `removeOnComplete` 1 Tag, `removeOnFail` 7 Tage
- [ ] 1.2 `src/notifier.ts`: Option `enqueue(body)` (Einstellen statt direktem Versand, Fehler nur als Warnung), `sendTest` bleibt direkt
- [ ] 1.3 `src/notifier.ts`: `flush()` (Sammelmeldungen sofort einstellen, Fenster und Timer löschen)
- [ ] 1.4 `src/notifier.ts`: `makeNotificationProcessor({ url, post })` sendet `job.data`, wirft Fehler ohne URL

## 2. Verdrahtung

- [ ] 2.1 `src/main.ts`: bei konfigurierter URL Worker für `notifications` (Concurrency 1) mit `attachWorkerLogging` ohne `onFinalFailure`, Notifier mit `enqueue` auf die Queue
- [ ] 2.2 `src/shutdown.ts`: optionales Feld `notifier`, `flush()` nach dem Schließen der Worker und vor dem Schließen der Queues, Fehler stoppen den Shutdown nicht; Worker und Queue von `notifications` in den Ressourcenlisten
- [ ] 2.3 `src/cli.ts`: `notificationsQueue` beim Schließen nach `requeue` berücksichtigen

## 3. Tests und Prüfung

- [ ] 3.1 `src/notifier.test.ts`: Einstellen statt Senden (Nutzlast, Flutbegrenzung unverändert), Einstellen schlägt fehl (Warnung, kein Wurf), `flush` mit und ohne ausstehende Sammelmeldung, Prozessor sendet `job.data`, Prozessor-Fehler enthält die URL nicht
- [ ] 3.2 `src/shutdown.test.ts`: `flush` nach den Workern und vor den Queues, ein Fehler in `flush` stoppt die Kette nicht, ohne Notifier unverändert
- [ ] 3.3 Einmalig gegen echtes BullMQ und Redis (Scratch-Skript, eigene Redis-DB): Wiederholungen mit Backoff (Webhook liefert zuerst Fehler, dann Erfolg), Job in der Fehlerliste nach allen Versuchen, `failedReason` ohne URL
- [ ] 3.4 Lokal mit Mini-Webhook: Nachricht kommt auch an, wenn der Webhook beim Fehlschlag noch nicht lief (nach dem ersten Wiederholungsversuch), Sammelmeldung beim Beenden wird nach dem Neustart zugestellt, kein Benachrichtigungs-Job bei kaputtem Webhook
- [ ] 3.5 `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec biome ci src`, `pnpm run build`, jeweils mit Exit-Code geprüft

## 4. Dokumentation und Abschluss

- [ ] 4.1 `docs/configuration.md` (Abschnitt Notifications: Zustellung mit Wiederholung, Dubletten, Bull Board), README, `CLAUDE.md` (Key components, Hinweis zur Schleifenvermeidung), `app-sequence.mermaid` (neue Queue)
- [ ] 4.2 Change archivieren (`openspec archive queue-notifications`), Commit als `feat:`
