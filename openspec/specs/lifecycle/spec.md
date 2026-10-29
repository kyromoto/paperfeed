# lifecycle Specification

## Purpose
Definiert die Startreihenfolge der Anwendung und das geordnete Herunterfahren bei Signalen, damit laufende Jobs nicht abgebrochen und Ressourcen sauber geschlossen werden.

## Requirements

### Requirement: Startreihenfolge
Das System SHALL beim Start Konfiguration laden, Datenverzeichnis und FileStore anlegen, SQLite öffnen und migrieren, Redis verbinden, Queues und Worker erzeugen, den Startup-Scan einstellen, den HTTP-Server starten, die Drive-Monitore starten und zuletzt den Renewal-Scheduler starten.

#### Scenario: Normaler Start
- **WHEN** alle Abhängigkeiten erreichbar sind
- **THEN** meldet die App die Startdauer und nimmt Webhooks entgegen

### Requirement: Fataler Startfehler
Das System SHALL bei einem Fehler während des Starts diesen als `fatal` loggen und mit Exit-Code 1 beenden.

#### Scenario: Redis nicht erreichbar
- **WHEN** die Redis-Verbindung fehlschlägt
- **THEN** endet der Prozess mit Exit-Code 1

### Requirement: Geordnetes Herunterfahren
Das System SHALL bei SIGINT, SIGTERM, SIGHUP und `uncaughtException` nacheinander HTTP-Server, Renewal-Scheduler, Worker (wartet auf laufende Jobs), Drive-Monitore, die ausstehende Sammelmeldung des Notifiers (falls Benachrichtigungen konfiguriert sind), Queues, Redis und Datenbank schließen und anschließend beenden.

#### Scenario: SIGTERM mit laufendem Job
- **WHEN** ein `process-changes`-Job läuft und SIGTERM eintrifft
- **THEN** wird der Job zu Ende geführt, bevor Redis und die Datenbank geschlossen werden

#### Scenario: Ausstehende Sammelmeldung
- **WHEN** beim Herunterfahren eine Sammelmeldung zurückgehalten ist
- **THEN** wird sie eingestellt, nachdem die Worker beendet sind und bevor die Queues geschlossen werden

### Requirement: Shutdown-Timeout
Das System SHALL das Herunterfahren nach 30 Sekunden mit Exit-Code 1 erzwingen.

#### Scenario: Hängender Schritt
- **WHEN** das Herunterfahren länger als 30 Sekunden dauert
- **THEN** beendet sich der Prozess mit Exit-Code 1

### Requirement: Fehler beim Herunterfahren
Das System SHALL Fehler einzelner Shutdown-Schritte loggen und mit den übrigen Schritten fortfahren.

#### Scenario: Channel-Stop schlägt fehl
- **WHEN** ein Drive-Monitor beim Stoppen einen Fehler wirft
- **THEN** werden Queues, Redis und DB trotzdem geschlossen
