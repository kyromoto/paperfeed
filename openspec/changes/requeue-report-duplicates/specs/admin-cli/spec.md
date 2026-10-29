## MODIFIED Requirements

### Requirement: Dateien erneut einstellen
Das System SHALL mit `requeue <account>` alle aktuell im Quellordner des Accounts liegenden Dateien als `process-changes`-Jobs mit denselben `jobId`- und `deduplication.id`-Schemata und Queue-Optionen wie die App einstellen und getrennt ausgeben, wie viele Jobs neu angelegt wurden und wie viele Dateien bereits in der Queue standen.

#### Scenario: Dateien im Quellordner
- **WHEN** der Quellordner Dateien enthält
- **THEN** wird pro Datei ein Job eingestellt, Dateien mit bereits laufendem Job werden durch Deduplizierung nicht doppelt verarbeitet

#### Scenario: Leerer Quellordner
- **WHEN** keine Dateien vorhanden sind
- **THEN** werden keine Jobs eingestellt, die CLI meldet, dass der Quellordner keine Dateien enthält, und der Exit-Code ist 0

#### Scenario: Alle Dateien neu
- **WHEN** der Quellordner zwei Dateien enthält, für die noch kein Job existiert
- **THEN** meldet die CLI `2 file(s) queued, 0 already queued` und in der Queue liegen zwei neue Jobs

#### Scenario: Datei steht bereits in der Queue
- **WHEN** `requeue` erneut ausgeführt wird, während der Job der Datei noch wartet oder läuft
- **THEN** meldet die CLI `0 file(s) queued, 1 already queued` und die Zahl der Jobs in der Queue bleibt unverändert

#### Scenario: Gemischter Fall
- **WHEN** eine von drei Dateien bereits einen Job hat
- **THEN** meldet die CLI `2 file(s) queued, 1 already queued` und der Exit-Code ist 0
