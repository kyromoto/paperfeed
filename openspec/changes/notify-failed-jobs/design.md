# Design

## Context

- `attachWorkerLogging` (`src/queue-utils.ts`) registriert pro Worker die Ereignisse `active`, `completed`, `failed` und den Queue-Fehler. `main.ts` ruft es für alle drei Queues auf und übergibt ein `getLabel` (z. B. `"<Datei> processing"`).
- Wiederholungen sind nur bei `renew-channel` konfiguriert (`attempts: 3`, exponentielles Backoff). `collect-changes` und `process-changes` haben keine `attempts` (ein Versuch): Dort ist jeder Fehlschlag endgültig.
- Hookshot-Betrieb des Inhabers: pro Server ein unverschlüsselter Raum, pro Anwendung ein eigener generischer Webhook (angelegt im Raum mit `!hookshot webhook <name>`). Der Standard-Webhook nimmt JSON mit `text` (plus optional `html`, `username`) und postet es als Nachricht. Die URL ist ein Secret.
- Die Server-Einstellungen kommen ausschließlich aus `SERVER_*`-Variablen (`src/config-env.ts`, Tabelle `SERVER_VARIABLES`), Zod-Schema in `src/types.ts`.

## Goals / Non-Goals

**Goals:**
- Endgültige Fehlschläge melden, ohne die Pipeline zu beeinflussen.
- Keine Abhängigkeit der App von Matrix: ein generischer Webhook genügt.
- Flutbegrenzung, damit ein Ausfall von Paperless nicht den Raum überschwemmt.

**Non-Goals:**
- Erfolgsmeldungen, andere Kanäle, Wiederholung der Zustellung, einstellbare Drosselung, formatierte Nachrichten, Ende-zu-Ende-Verschlüsselung.

## Decisions

1. **Generischer Webhook statt Matrix-Client-API:** Die App sendet `POST` mit `{ username, text }`. Kein Token, keine Raum-ID, keine Transaktions-ID, kein Krypto-Problem in verschlüsselten Räumen. Andere Webhook-Ziele wären mit gleicher Nutzlast denkbar, ohne dass die App sie kennen muss.
2. **Neue Einstellung `SERVER_NOTIFICATIONS_WEBHOOK_URL`** (optional, `string`, Pfad `server.notifications.webhook_url`) in `SERVER_VARIABLES` und im Zod-Schema `Server` (`notifications: { webhook_url: z.string().url() }.optional()`). Env-only und ohne `*_FILE`, wie die übrigen Server-Einstellungen.
3. **Endgültigkeit:** im `failed`-Ereignis `job.attemptsMade >= (job.opts.attempts ?? 1)`. Dass `attemptsMade` im `failed`-Ereignis den fehlgeschlagenen Versuch bereits enthält, wird gegen echtes BullMQ geprüft (Task 3.2). Ein `failed`-Ereignis ohne Job (z. B. Stalled-Limit) zählt als endgültig, wenn kein Job vorliegt, und wird mit `queue` und Fehlermeldung gemeldet.
4. **Neues Modul `src/notifier.ts`:** `createNotifier({ url, post, logger, now })` liefert `notifyFinalFailure(info)` und `sendTest()`. `post` ist die HTTP-Funktion (Standard `axios.post` mit `timeout: 5000`), `now`/Timer sind austauschbar, damit die Flutbegrenzung mit Fake-Timern testbar ist. Ohne URL liefert eine Fabrikfunktion `undefined`, `main.ts` übergibt dann keinen Callback.
5. **Hook in `attachWorkerLogging`:** neuer optionaler sechster Parameter `onFinalFailure(info)`, aufgerufen im `failed`-Handler nach dem Logeintrag. Der Aufruf ist `void`: Fehler im Notifier werden darin abgefangen und dürfen nie in den Worker propagieren.
6. **Nachrichtentext (Englisch, wie die übrigen Meldungen):**
   ```
   paperfeed: job failed permanently
   queue: process-changes
   job: invoice.pdf processing
   error: Paperless upload failed
   attempts: 1/1
   ```
   Job-Beschreibung ist das vorhandene `getLabel(job.data)`. Fehlermeldung auf 500 Zeichen gekürzt (`…` angehängt). Die Verbesserung der Labels (Account-Name statt ID bei `collect-changes`/`renew-channel`) ist nicht Teil dieser Change.
7. **Flutbegrenzung je Queue:** Zustand `{ lastSentAt, suppressed }` pro Queue-Name. Der erste Fehlschlag sendet sofort und startet ein 60-Sekunden-Fenster. Weitere Fehlschläge im Fenster erhöhen `suppressed`. Am Ende des Fensters sendet ein einmaliger, `unref`-ter Timer eine Sammelnachricht (`N more jobs failed permanently`), falls `suppressed > 0`, und setzt den Zustand zurück. Beim Beenden des Prozesses gehen nicht mehr gesendete Sammelnachrichten verloren (bewusst akzeptiert, die Jobs stehen in Bull Board).
8. **Fehlerbehandlung beim Senden:** Timeout 5 s, kein erneuter Versuch. Fehler werden als `warn` mit HTTP-Status oder Fehlercode und Meldung geloggt, nie mit `error.config`, `error.request` oder der URL. Der Notifier verändert weder Jobs noch Exit-Codes.
9. **`notify-test`:** CLI-Kommando, nutzt dieselbe Fabrik, sendet „paperfeed: test notification“ und meldet den Status (Exit 0/1). Ohne konfigurierte URL Exit 1 mit Hinweis. Die Ausgabe enthält die URL nicht.
10. **Sicherheit der URL:** Sie wird nicht geloggt, steht aber in der Umgebung des Containers (`docker inspect`). `validate-config` gibt sie nicht aus; es zeigt nur „notifications: enabled/disabled“.

## Risks / Trade-offs

- **Verlorene Nachrichten:** Fällt Hookshot aus oder wird die App beendet, gehen Nachrichten (und ausstehende Sammelmeldungen) verloren. Akzeptiert (Best Effort), Logs und Bull Board bleiben die verlässliche Quelle.
- **Flut trotz Begrenzung:** Mit mehreren Queues sind bis zu drei Nachrichten pro Minute möglich. Akzeptiert.
- **Darstellung in Matrix:** Ob `text` mit Zeilenumbrüchen in Hookshot wie erwartet dargestellt wird, ist am echten Hookshot zu prüfen (Task 3.3). Bei Bedarf wird zusätzlich `html` gesendet.
- **Datenschutz:** Der Text enthält Dateinamen. Für einen eigenen Server und Raum vertretbar, aber zu beachten.
- **Timer im Prozess:** Die Sammelmeldung hängt an einem `unref`-ten Timer und blockiert das Beenden nicht.
