# Proposal

## Why

Die Pipeline läuft unbeaufsichtigt. Scheitert ein Job endgültig (eine Datei bleibt im Quellordner liegen, oder die Erneuerung des Webhook-Channels schlägt nach allen Versuchen fehl und es kommen keine Benachrichtigungen mehr an), sieht man das heute nur in den Logs oder in Bull Board. Eine Nachricht in einen Matrix-Raum macht solche Ausfälle sichtbar.

Der Betreiber hat einen eigenen Matrix-Server mit Hookshot, pro Server einen unverschlüsselten Raum und pro Anwendung einen eigenen generischen Webhook. Die App muss dafür kein Matrix sprechen, sondern nur einen Webhook aufrufen. Das ersetzt den früheren Backlog-Plan (Matrix-Client-API mit Zugriffstoken, Raum-ID und Transaktions-ID in der YAML).

## What Changes

- Neue optionale Einstellung `SERVER_NOTIFICATIONS_WEBHOOK_URL` (URL eines generischen Hookshot-Webhooks). Ohne Wert sind Benachrichtigungen aus, das Verhalten ändert sich dann nicht.
- Endgültig fehlgeschlagene Jobs aller drei Queues (`collect-changes`, `process-changes`, `renew-channel`) lösen eine Nachricht aus. Fehlgeschlagene Versuche, die BullMQ wiederholt, lösen keine aus. Erkannt wird das über `attemptsMade >= attempts` im `failed`-Ereignis des Workers.
- Die Nachricht ist ein HTTP-POST mit JSON `{ "username": "paperfeed", "text": "…" }` und nennt Queue, Job-Beschreibung, gekürzte Fehlermeldung und Versuche. Keine Zugangsdaten, keine Dateiinhalte.
- Best Effort: kurzes Timeout, Fehler des Webhooks werden nur geloggt (ohne die URL, sie ist ein Secret) und beeinflussen keinen Job.
- Flutbegrenzung je Queue: Die erste Nachricht geht sofort raus, weitere Ausfälle derselben Queue innerhalb von 60 Sekunden werden gezählt und danach in einer Sammelnachricht gemeldet.
- Neues CLI-Kommando `notify-test`, das eine Testnachricht an den Webhook sendet.
- Dokumentation (`docs/configuration.md`, README, `CLAUDE.md`) und Backlog (Eintrag „Matrix-Benachrichtigung“ entfällt).

Nicht Teil dieser Change: Benachrichtigung bei Erfolg oder App-Start, andere Kanäle (E-Mail, ntfy), Wiederholung fehlgeschlagener Zustellungen, einstellbare Drosselung, HTML-Formatierung der Nachricht, Verschlüsselung.

## Capabilities

### New Capabilities
- `notifications`: Webhook-Benachrichtigung bei endgültig fehlgeschlagenen Jobs.

### Modified Capabilities
- `configuration`: neue optionale Variable `SERVER_NOTIFICATIONS_WEBHOOK_URL`.
- `admin-cli`: neues Kommando `notify-test`.

## Impact

- Neu: `src/notifier.ts`, `src/notifier.test.ts`.
- Geändert: `src/queue-utils.ts` (`attachWorkerLogging` erhält `onFinalFailure`), `src/main.ts` (Notifier erzeugen und anbinden), `src/config-env.ts` und `src/types.ts` (optionale Einstellung), `src/cli.ts` (`notify-test`), `docs/configuration.md`, README, `CLAUDE.md`, `BACKLOG.md`.
- Keine neuen Abhängigkeiten (`axios` ist vorhanden).
- Release als `feat:` (Minor). Bestehende Deployments verhalten sich ohne die neue Variable unverändert.
- Die Webhook-URL enthält ein Secret und steht in der Umgebung; sie ist per `docker inspect` sichtbar. Für diese Variable gibt es bewusst kein `*_FILE`.
