## MODIFIED Requirements

### Requirement: Geordnetes Herunterfahren
Das System SHALL bei SIGINT, SIGTERM, SIGHUP und `uncaughtException` nacheinander HTTP-Server, Renewal-Scheduler, Worker (wartet auf laufende Jobs), Drive-Monitore, die ausstehende Sammelmeldung des Notifiers (falls Benachrichtigungen konfiguriert sind), Queues, Redis und Datenbank schließen und anschließend beenden.

#### Scenario: SIGTERM mit laufendem Job
- **WHEN** ein `process-changes`-Job läuft und SIGTERM eintrifft
- **THEN** wird der Job zu Ende geführt, bevor Redis und die Datenbank geschlossen werden

#### Scenario: Ausstehende Sammelmeldung
- **WHEN** beim Herunterfahren eine Sammelmeldung zurückgehalten ist
- **THEN** wird sie eingestellt, nachdem die Worker beendet sind und bevor die Queues geschlossen werden
