# file-processing Specification

## Purpose
Verarbeitet eine Datei in drei Schritten: aus Google Drive herunterladen, an Paperless-ngx übertragen, im Drive in den Zielordner verschieben. Jeder Schritt wird im Job-Datum festgehalten, damit Retries am letzten Schritt fortsetzen.

## Requirements

### Requirement: Schrittfolge mit Fortsetzung
Das System SHALL die Schritte `download → upload → move` nacheinander ausführen und nach jedem Schritt den Fortschritt (`downloaded`, `uploaded`, `moved`, `done`) im Job-Datum speichern.

#### Scenario: Retry nach Upload
- **WHEN** ein Job nach dem Schritt `uploaded` neu gestartet wird
- **THEN** wird nur noch das Verschieben ausgeführt, nicht erneut heruntergeladen oder hochgeladen

### Requirement: Download in lokalen Zwischenspeicher
Das System SHALL die Datei als Stream in `{data_path}/files/{accountId}_{fileId}` ablegen.

#### Scenario: Download
- **WHEN** der Schritt `download` läuft
- **THEN** liegt die Datei vollständig im FileStore, bevor der Upload beginnt

### Requirement: Upload nach Paperless-ngx
Das System SHALL die Datei per `POST {server_url}/api/documents/post_document/` mit Basic-Auth als Feld `document` (Dateiname und MIME-Type des Originals) übertragen und den Zwischenspeicher nach Erfolg löschen.

#### Scenario: Paperless antwortet nicht mit 200
- **WHEN** die Antwort einen anderen Status als 200 hat
- **THEN** schlägt der Job fehl, der Zwischenspeicher bleibt erhalten

### Requirement: Verschieben im Drive
Das System SHALL die Datei durch `files.update` mit `addParents = dst` und `removeParents = src` in den Zielordner verschieben.

#### Scenario: Erfolgreiche Verarbeitung
- **WHEN** alle Schritte durchlaufen
- **THEN** liegt die Datei im Zielordner und nicht mehr im Quellordner

### Requirement: Sequentielle Verarbeitung
Das System SHALL `process-changes` standardmäßig mit Concurrency 1 ausführen, weil der FileStore-Pfad pro Datei nicht für parallele Zugriffe auf dieselbe Datei ausgelegt ist.

#### Scenario: Standardkonfiguration
- **WHEN** `queue.concurrency.process` nicht gesetzt ist
- **THEN** wird höchstens ein `process-changes`-Job gleichzeitig ausgeführt
