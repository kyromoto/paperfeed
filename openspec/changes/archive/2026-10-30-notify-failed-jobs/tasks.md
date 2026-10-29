# Tasks

## 1. Konfiguration

- [x] 1.1 `SERVER_NOTIFICATIONS_WEBHOOK_URL` in `SERVER_VARIABLES` (`src/config-env.ts`, optional, Pfad `notifications.webhook_url`) und im Zod-Schema `Server` (`src/types.ts`, optionaler Block mit URL)
- [x] 1.2 Tests in `src/config-env.test.ts`: Variable nicht gesetzt, gültige URL, ungültige URL (Meldung nennt die Variable, nicht den Wert)

## 2. Notifier

- [x] 2.1 `src/notifier.ts`: `createNotifier` mit austauschbarer HTTP-Funktion und Uhr, Nachrichtentext, Kürzung auf 500 Zeichen, Timeout 5 s, Fehler nur als Warnung ohne URL
- [x] 2.2 Flutbegrenzung je Queue (Sofortmeldung, Zählen im 60-Sekunden-Fenster, Sammelmeldung über `unref`-ten Timer)
- [x] 2.3 `attachWorkerLogging` um `onFinalFailure(info)` erweitern, Erkennung `attemptsMade >= (attempts ?? 1)`, Fehler im Callback werden abgefangen
- [x] 2.4 `src/main.ts`: Notifier aus der Konfiguration erzeugen (nur bei gesetzter URL) und an alle drei `attachWorkerLogging`-Aufrufe übergeben
- [x] 2.5 `notify-test` in `src/cli.ts`

## 3. Tests und Prüfung

- [x] 3.1 `src/notifier.test.ts`: Text und Nutzlast, Kürzung, Timeout-Option, Fehler loggen ohne URL, Sofortmeldung, Zählen und Sammelmeldung mit Fake-Timern, Queues getrennt, kein Netzwerkaufruf ohne URL
- [x] 3.2 Einmalig gegen echtes BullMQ und Redis (Scratch-Skript): `failed`-Ereignis bei `attempts` 1 und 3, `attemptsMade` je Versuch, nur der letzte Versuch gilt als endgültig (Befund: BullMQ speichert `attempts: 0` für Jobs ohne die Option; `attemptsMade` im `failed`-Ereignis enthält den fehlgeschlagenen Versuch. Umsetzung nutzt `max(attempts, 1)`, mit Test)
- [x] 3.3 Manuell gegen den echten Hookshot-Webhook: `pnpm run cli notify-test`, Darstellung der Nachricht im Raum (am 2026-10-29 geprüft: Rohdaten zeigen `<p><strong>paperfeed</strong>: test notification</p><ul><li>…`, Zeilen als Aufzählung). Ende-zu-Ende der Verdrahtung lokal mit Mini-Webhook geprüft: drei fehlschlagende `process-changes`-Jobs ergeben sofort eine Meldung und nach 60,0 s eine Sammelmeldung `2 more jobs failed permanently`; die Webhook-URL steht nicht im Log. Ein Fehlschlag mit echtem Paperless-Ausfall wurde nicht gesondert getestet.
- [x] 3.4 `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec biome ci src`, `pnpm run build`

## 4. Dokumentation und Abschluss

- [x] 4.1 `docs/configuration.md` (Variable, Beispiel, Hinweis zum Secret), README (Abschnitt Notifications mit Hookshot-Einrichtung), `CLAUDE.md` (Key components), `.env.example`, `docker-compose.example.yml`
- [x] 4.2 `BACKLOG.md`: Eintrag „Matrix-Benachrichtigung“ entfernen (Eintrag entfernt)
- [ ] 4.3 Change archivieren (`openspec archive notify-failed-jobs`), Commit als `feat:`
