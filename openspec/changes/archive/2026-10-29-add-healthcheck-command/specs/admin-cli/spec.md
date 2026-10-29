## ADDED Requirements

### Requirement: Healthcheck
Das System SHALL mit `healthcheck` den Endpoint `GET /health` der lokalen App unter `127.0.0.1` auf dem Port `server.http.port` der Konfiguration aufrufen (Timeout 4 s) und mit Exit-Code 0 bei Erfolg und 1 bei Fehler beenden, sodass das Docker-`HEALTHCHECK` keinen festen Port enthalten muss.

#### Scenario: App läuft
- **WHEN** die App auf dem konfigurierten Port antwortet
- **THEN** gibt die CLI `OK <url>` aus und beendet sich mit Exit-Code 0

#### Scenario: App nicht erreichbar
- **WHEN** die Verbindung fehlschlägt oder zeitüberschreitet
- **THEN** gibt die CLI `FAILED <url>` mit der Ursache aus und beendet sich mit Exit-Code 1
