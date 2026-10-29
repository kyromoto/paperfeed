# Proposal

## Why

Benachrichtigungen über endgültig fehlgeschlagene Jobs werden heute direkt im Prozess per HTTP gesendet: ein Versuch, 5 Sekunden Timeout, kein Wiederholen. Ist der Webhook (Matrix Hookshot) gerade nicht erreichbar, geht die Nachricht verloren. Auch eine noch ausstehende Sammelmeldung des Flutbegrenzungs-Fensters geht beim Beenden der App verloren. Gerade bei Ausfällen der Umgebung, die zu den Fehlschlägen geführt haben können (Netzwerk, Server-Neustart), sollen die Meldungen zugestellt werden, sobald der Webhook wieder antwortet.

## What Changes

- Neue BullMQ-Queue `notifications` mit eigenem Worker (Concurrency 1). Der Notifier stellt statt des direkten HTTP-Aufrufs einen Job mit der Nachricht (`{ username, text }`) ein, der Worker sendet ihn an den Webhook.
- Zustellung mit Wiederholung: 6 Versuche mit exponentiellem Backoff ab 30 Sekunden (30 s, 60 s, 120 s, 240 s, 480 s, insgesamt rund 15 Minuten). Wartende Jobs überleben einen Neustart der App.
- Keine Benachrichtigung über Benachrichtigungen: Die Queue `notifications` löst keine eigene Meldung aus. Scheitern alle Versuche, bleibt der Job in der Fehlerliste (sichtbar in Bull Board) und wird mit Level `error` geloggt.
- Fehlermeldungen der Zustellversuche enthalten die Webhook-URL nicht (sie werden in Redis gespeichert und sind in Bull Board sichtbar).
- Beim geordneten Herunterfahren stellt der Notifier eine noch ausstehende Sammelmeldung sofort ein (`flush`), bevor die Queues geschlossen werden. Sie wird nach dem Neustart zugestellt.
- Die Flutbegrenzung (60-Sekunden-Fenster je Queue, Sammelmeldung) und das Nachrichtenformat bleiben unverändert und wirken weiterhin beim Einstellen.
- `notify-test` sendet weiter direkt und meldet das Ergebnis sofort.
- Dokumentation, `CLAUDE.md` und `app-sequence.mermaid` (neue Queue).

Nicht Teil dieser Change: Zeitstempel in der Nachricht (eine verspätet zugestellte Meldung zeigt die Zustellzeit), mehrere Webhook-Ziele, Benachrichtigung über Erfolge, Änderung der Flutbegrenzung.

## Capabilities

### New Capabilities
<!-- Keine -->

### Modified Capabilities
- `notifications`: Zustellung über eigene Queue mit Wiederholung, keine Benachrichtigung über Benachrichtigungen, Sammelmeldung beim Beenden.
- `lifecycle`: Reihenfolge beim geordneten Herunterfahren um das Einstellen der ausstehenden Sammelmeldung ergänzt.

## Impact

- Geändert: `src/queues.ts` (vierte Queue), `src/notifier.ts` (`enqueue`-Transport, `flush`, Prozessor für den Worker), `src/main.ts` (Worker und Verdrahtung), `src/shutdown.ts` (`flush` vor dem Schließen der Queues), `src/cli.ts` (neue Queue beim Schließen), `docs/configuration.md`, README, `CLAUDE.md`, `app-sequence.mermaid`.
- Keine neue Konfiguration und keine neuen Abhängigkeiten. Ohne `SERVER_NOTIFICATIONS_WEBHOOK_URL` ändert sich nichts (die Queue ist angelegt, aber leer, ein Worker läuft nicht).
- Redis enthält zusätzlich die Schlüssel der Queue `notifications` (Bull Board zeigt sie automatisch an).
- Release als `feat:` (Minor).
- Zustellung ist „mindestens einmal“: Antwortet der Webhook nach dem Timeout verspätet, obwohl er die Nachricht angenommen hat, kann ein Wiederholungsversuch eine doppelte Meldung erzeugen.
