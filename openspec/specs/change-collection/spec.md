# change-collection Specification

## Purpose
Ermittelt über die Drive-Changes-API, welche Dateien im Quellordner neu sind, und stellt pro Datei einen `process-changes`-Job ein. Der Change-Token liegt in SQLite (`change_tokens`).

## Requirements

### Requirement: Change-Token pro Account und Ordner
Das System SHALL den Drive-Change-Token je `(accountId, folderId)` in SQLite speichern und nach jedem vollständigen Durchlauf mit `newStartPageToken` aktualisieren.

#### Scenario: Erster Durchlauf ohne Token
- **WHEN** weder ein Token in SQLite noch eine Legacy-Token-Datei existiert
- **THEN** wird über `changes.getStartPageToken` ein neuer Token geholt und gespeichert

#### Scenario: Legacy-Token vorhanden
- **WHEN** nur die alte Datei `{data_path}/tokens/{accountId}.{folderId}.change-token.txt` existiert
- **THEN** wird ihr Inhalt in SQLite übernommen

### Requirement: Nur Dateien des Quellordners
Das System SHALL aus allen Änderungen nur Dateien weitergeben, die aktuell im Quellordner liegen (nicht gelöscht, keine Ordner).

#### Scenario: Änderung außerhalb des Quellordners
- **WHEN** eine Änderung eine Datei betrifft, die nicht im Listing des Quellordners vorkommt
- **THEN** wird sie nicht verarbeitet

### Requirement: Ein Job pro Datei
Das System SHALL nach einem `collect-changes`-Lauf für jede gefundene Datei einen `process-changes`-Job mit `jobId = process-changes-{accountId}-{fileId}-{timestamp}` und `deduplication.id = process-changes-{accountId}-{fileId}` einstellen.

#### Scenario: Datei bereits in Verarbeitung
- **WHEN** für dieselbe Datei bereits ein Job mit gleicher Deduplication-ID existiert
- **THEN** wird kein zweiter Job angelegt

### Requirement: Startup-Scan
Das System SHALL beim Start alle aktuell im Quellordner liegenden Dateien direkt als `process-changes`-Jobs einstellen, ohne den Change-Token zu verwenden.

#### Scenario: App war offline
- **WHEN** während der Downtime Dateien abgelegt wurden
- **THEN** werden sie beim Start eingestellt
