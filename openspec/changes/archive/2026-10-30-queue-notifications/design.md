# Design

## Context

- `createNotifier` (`src/notifier.ts`) sendet heute direkt per `axios.post` und hält die Flutbegrenzung (Fenster je Queue, Sammelmeldung über `unref`-ten Timer) im Speicher. `notify-test` nutzt dieselbe Funktion und braucht eine sofortige Rückmeldung.
- `createQueues` (`src/queues.ts`) erzeugt die drei Queues, `main.ts` die Worker, `shutdown.ts` schließt Worker und Queues in fester Reihenfolge, `cli.ts` schließt die Queues nach `requeue`.
- Fehlermeldungen und `failedReason` von BullMQ-Jobs werden in Redis gespeichert und in Bull Board angezeigt: Sie dürfen die Webhook-URL nicht enthalten.
- BullMQ speichert `attempts: 0` für Jobs ohne die Option; hier werden Versuche über `defaultJobOptions` gesetzt.

## Goals / Non-Goals

**Goals:**
- Nachrichten überstehen kurze Ausfälle des Webhooks und Neustarts der App.
- Keine Schleife: Fehler der Zustellung erzeugen keine Benachrichtigung.
- Flutbegrenzung und Nachrichtenformat bleiben unverändert.

**Non-Goals:**
- Zeitstempel in der Nachricht, mehrere Ziele, Erfolgsmeldungen, Änderung der Drosselung.

## Decisions

1. **Eigene Queue `notifications`** (`NOTIFICATIONS_QUEUE`) in `createQueues`, Rückgabe als `notificationsQueue`. Default-Optionen: `attempts: 6`, `backoff: { type: "exponential", delay: 30_000 }` (30 s, 60 s, 120 s, 240 s, 480 s), `removeOnComplete: { age: 1 Tag }`, `removeOnFail: { age: 7 Tage }`. Ein Webhook-Ausfall von bis zu etwa 15 Minuten wird so überbrückt; danach bleibt der Job in der Fehlerliste, sichtbar in Bull Board.
2. **Transport austauschbar:** `createNotifier` erhält die Option `enqueue(body)`. Ist sie gesetzt, stellt `notifyFinalFailure` die Nachricht ein (Fehler beim Einstellen nur als Warnung), sonst bleibt der direkte Versand wie heute. `sendTest` sendet immer direkt, damit `notify-test` ein Ergebnis liefert. Flutbegrenzung und Formatierung bleiben unverändert im Notifier.
3. **Prozessor für den Worker:** `makeNotificationProcessor({ url, post })` in `src/notifier.ts` sendet `job.data` (`{ username, text }`) und wirft bei Fehler einen Fehler **ohne URL** (derselbe Schwärzungsmechanismus wie `describeSendError`), weil `failedReason` in Redis liegt. Die Queue-Daten enthalten nie die URL, nur Text und Benutzername.
4. **Worker:** in `main.ts` nur, wenn Benachrichtigungen konfiguriert sind, Concurrency 1 (Reihenfolge der Meldungen bleibt weitgehend erhalten, Hookshot wird nicht parallel belastet). `attachWorkerLogging` loggt Versuche (`warn` je fehlgeschlagenem Versuch ohne URL, `error` beim endgültigen Scheitern) und bekommt **keinen** `onFinalFailure`-Callback: Das ist die Schleifenvermeidung.
5. **Ohne konfigurierten Webhook:** Die Queue wird angelegt (wie die anderen, wegen `createQueues`), aber es läuft kein Worker und der Notifier existiert nicht. Es werden keine Jobs eingestellt.
6. **`flush()` des Notifiers:** stellt für jede Queue mit zurückgehaltenen Meldungen die Sammelmeldung sofort ein, löscht die Fenster und deren Timer. `shutdown.ts` ruft es nach dem Schließen der Worker (damit keine neuen Fehlschläge mehr hinzukommen) und vor dem Schließen der Queues auf. `ShutdownResources` erhält ein optionales Feld `notifier`. Ein Fehler in `flush` stoppt den Shutdown nicht (wie die anderen Schritte).
7. **Mindestens-einmal-Zustellung:** Kommt die Antwort des Webhooks nach dem Timeout, obwohl die Nachricht angenommen wurde, entsteht beim Wiederholen eine Dublette. Akzeptiert; BullMQ bietet keine exactly-once-Zustellung, und der Webhook kennt keine Idempotenz-Schlüssel.
8. **Verspätete Meldungen:** Der Text enthält keinen Zeitstempel; eine nach einem Ausfall zugestellte Meldung zeigt die Zustellzeit. Als Folgeaufgabe vermerkt, falls es stört.
9. **`cli.ts`:** `requeue` schließt zusätzlich `notificationsQueue`; `createQueues` wird in der CLI sonst unverändert benutzt.

## Risks / Trade-offs

- **Dubletten bei Wiederholungen** (siehe 7).
- **Verspätete Meldungen** ohne Zeitstempel (siehe 8).
- **Redis-Abhängigkeit:** Benachrichtigungen brauchen jetzt Redis zum Einstellen. Fällt Redis aus, scheitert ohnehin die Pipeline; das Einstellen schlägt dann mit Warnung fehl und die Meldung geht verloren.
- **Mehr Bauteile:** eine Queue, ein Worker, ein `flush`. Dafür entfällt die Abhängigkeit vom Zustand im Prozessspeicher bei der Zustellung. Der Fensterzustand der Flutbegrenzung bleibt im Speicher (Timer); `flush` verhindert den Verlust beim geordneten Beenden, bei einem Absturz bleibt er verloren.
- **Bull Board zeigt eine vierte Queue:** gewollt, so sind unzustellbare Meldungen sichtbar.
