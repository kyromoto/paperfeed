# notifications Specification

## Purpose
Meldet endgültig fehlgeschlagene Jobs über einen generischen Webhook (z. B. Matrix Hookshot) an einen Betreiber-Kanal, damit unbeaufsichtigte Ausfälle der Pipeline sichtbar werden, ohne den Ablauf der Jobs zu beeinflussen.

## Requirements

### Requirement: Benachrichtigung nur bei konfiguriertem Webhook
Das System SHALL Benachrichtigungen nur senden, wenn `SERVER_NOTIFICATIONS_WEBHOOK_URL` gesetzt ist. Ohne den Wert SHALL das Verhalten der App unverändert bleiben und kein Netzwerkaufruf erfolgen.

#### Scenario: Kein Webhook konfiguriert
- **WHEN** `SERVER_NOTIFICATIONS_WEBHOOK_URL` nicht gesetzt ist und ein Job endgültig fehlschlägt
- **THEN** wird nur geloggt und keine Anfrage gesendet

### Requirement: Nur endgültige Fehlschläge melden
Das System SHALL eine Benachrichtigung auslösen, wenn ein Job in `collect-changes`, `process-changes` oder `renew-channel` fehlschlägt und alle konfigurierten Versuche verbraucht sind (`attemptsMade >= attempts`, ohne Angabe gilt ein Versuch). Fehlschläge, die BullMQ erneut versucht, SHALL keine Benachrichtigung auslösen.

#### Scenario: Job ohne Wiederholung scheitert
- **WHEN** ein `process-changes`-Job (ein Versuch) fehlschlägt
- **THEN** wird eine Benachrichtigung gesendet

#### Scenario: Wiederholbarer Job scheitert im ersten Versuch
- **WHEN** ein `renew-channel`-Job (drei Versuche) im ersten Versuch fehlschlägt
- **THEN** wird keine Benachrichtigung gesendet

#### Scenario: Letzter Versuch scheitert
- **WHEN** der dritte Versuch eines `renew-channel`-Jobs fehlschlägt
- **THEN** wird eine Benachrichtigung gesendet

### Requirement: Nachrichteninhalt
Das System SHALL die Nachricht als HTTP-POST mit JSON `{ "username": "paperfeed", "text": "<Text>" }` senden. Der Text SHALL die Queue, die Job-Beschreibung, die Fehlermeldung (auf höchstens 500 Zeichen gekürzt) und die Versuche (`attemptsMade/attempts`) nennen und SHALL weder Zugangsdaten noch Dateiinhalte enthalten.

#### Scenario: Datei konnte nicht verarbeitet werden
- **WHEN** der Job einer Datei `invoice.pdf` mit dem Fehler `Paperless upload failed` endgültig fehlschlägt
- **THEN** enthält der Text die Queue `process-changes`, die Datei `invoice.pdf`, die Meldung `Paperless upload failed` und `1/1`

#### Scenario: Sehr lange Fehlermeldung
- **WHEN** die Fehlermeldung länger als 500 Zeichen ist
- **THEN** wird sie gekürzt und als gekürzt gekennzeichnet

### Requirement: Best Effort
Das System SHALL Benachrichtigungen über die Queue `notifications` zustellen, den Webhook pro Versuch mit einem Timeout von 5 Sekunden aufrufen, fehlgeschlagene Versuche mit exponentiellem Backoff wiederholen und dabei niemals den auslösenden Job, die Worker oder den Prozess beeinträchtigen. Die Webhook-URL SHALL in keinem Log, keiner Fehlermeldung und keinem Job-Datum erscheinen.

#### Scenario: Webhook nicht erreichbar
- **WHEN** der Webhook nicht antwortet oder einen Fehlerstatus liefert
- **THEN** wird eine Warnung mit Statuscode bzw. Meldung ohne URL geloggt, der Zustellversuch wird später wiederholt und der auslösende Job-Ablauf bleibt unverändert

#### Scenario: Webhook kommt zurück
- **WHEN** der Webhook beim ersten Versuch nicht erreichbar ist und bei einem der Wiederholungsversuche wieder antwortet
- **THEN** wird die Nachricht zugestellt

#### Scenario: Redis beim Einstellen nicht erreichbar
- **WHEN** die Nachricht nicht in die Queue eingestellt werden kann
- **THEN** wird eine Warnung geloggt und der auslösende Job-Ablauf bleibt unverändert

### Requirement: Flutbegrenzung je Queue
Das System SHALL je Queue höchstens eine Nachricht pro 60 Sekunden senden: Der erste endgültige Fehlschlag wird sofort gemeldet, weitere derselben Queue innerhalb des Fensters werden gezählt und nach Ablauf des Fensters in einer Sammelnachricht (`N weitere Fehlschläge`) gemeldet.

#### Scenario: Viele Ausfälle in kurzer Zeit
- **WHEN** innerhalb von 60 Sekunden fünf `process-changes`-Jobs endgültig fehlschlagen
- **THEN** wird sofort eine Nachricht für den ersten gesendet und nach Ablauf des Fensters eine Sammelnachricht über die weiteren vier

#### Scenario: Unterschiedliche Queues
- **WHEN** innerhalb des Fensters je ein Job in `process-changes` und in `renew-channel` endgültig fehlschlägt
- **THEN** wird für jede Queue sofort eine Nachricht gesendet

### Requirement: Zustellung mit Wiederholung
Das System SHALL jede Nachricht als Job der Queue `notifications` mit 6 Versuchen und exponentiellem Backoff ab 30 Sekunden einstellen und mit genau einem Worker (Concurrency 1) abarbeiten. Nicht zugestellte Nachrichten SHALL einen Neustart der App überstehen.

#### Scenario: Neustart mit wartender Nachricht
- **WHEN** die App beendet wird, während ein Zustellversuch aussteht
- **THEN** wird die Nachricht nach dem Neustart zugestellt

#### Scenario: Alle Versuche scheitern
- **WHEN** alle 6 Versuche fehlschlagen
- **THEN** bleibt der Job in der Fehlerliste der Queue, es wird ein Fehler ohne URL geloggt und keine weitere Benachrichtigung ausgelöst

### Requirement: Keine Benachrichtigung über Benachrichtigungen
Das System SHALL für fehlgeschlagene Jobs der Queue `notifications` keine Benachrichtigung auslösen.

#### Scenario: Webhook dauerhaft kaputt
- **WHEN** der Webhook dauerhaft nicht antwortet
- **THEN** entstehen keine weiteren Benachrichtigungs-Jobs durch die fehlgeschlagene Zustellung

### Requirement: Ausstehende Sammelmeldung beim Beenden
Das System SHALL beim geordneten Herunterfahren eine noch ausstehende Sammelmeldung der Flutbegrenzung sofort in die Queue `notifications` einstellen, bevor die Queues geschlossen werden.

#### Scenario: Beenden im laufenden Fenster
- **WHEN** im 60-Sekunden-Fenster einer Queue Meldungen zurückgehalten wurden und die App beendet wird
- **THEN** wird die Sammelmeldung eingestellt und nach dem Neustart zugestellt

#### Scenario: Nichts zurückgehalten
- **WHEN** beim Beenden keine Meldung zurückgehalten ist
- **THEN** wird nichts eingestellt
