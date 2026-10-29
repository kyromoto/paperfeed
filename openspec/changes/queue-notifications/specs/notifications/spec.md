## MODIFIED Requirements

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

## ADDED Requirements

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
