# configuration Specification

## Purpose
Konfiguration über eine YAML-Datei (Pfad aus `CONFIG_PATH`) und wenige Umgebungsvariablen. Alle Werte werden mit Zod validiert.

## Requirements

### Requirement: Umgebungsvariablen
Das System SHALL `CONFIG_PATH` (Pflicht), `LOG_LEVEL` (Default `info`) und `NODE_ENV` (Default `development`) aus der Umgebung lesen und beim Start validieren.

#### Scenario: CONFIG_PATH fehlt
- **WHEN** `CONFIG_PATH` nicht gesetzt ist
- **THEN** bricht der Start beim Import von `env.ts` mit einem Validierungsfehler ab

### Requirement: YAML-Konfiguration
Das System SHALL aus der YAML-Datei die Abschnitte `server`, `drive_accounts`, `paperless_endpoints` und `accounts` lesen und gegen das Zod-Schema validieren.

#### Scenario: Ungültige Konfiguration
- **WHEN** die Validierung fehlschlägt
- **THEN** wird der Start mit einer Fehlermeldung abgebrochen

### Requirement: Account-Zuordnung
Das System SHALL jeden `account` über `drive_account_id` und `paperless_endpoint_id` mit genau einem Drive-Account und einem Paperless-Endpoint verknüpfen; mehrere Accounts laufen unabhängig.

#### Scenario: Unbekannte Drive-Account-ID
- **WHEN** ein Account auf einen nicht vorhandenen Drive-Account verweist
- **THEN** schlägt die Initialisierung der Prozessoren bzw. Monitore fehl

### Requirement: Secrets nicht loggen
Das System SHALL JWTs und Felder wie `private_key` und `password` vor der Ausgabe schwärzen und beim Start weder Umgebung noch komplette Konfiguration loggen.

#### Scenario: Debug-Logging
- **WHEN** Konfigurationswerte in Logs landen könnten
- **THEN** sind sensible Felder redigiert

### Requirement: Logformat
Das System SHALL Logs über Logtape nach stdout schreiben, in Produktion (`NODE_ENV=production`) als JSON Lines.

#### Scenario: Produktion
- **WHEN** `NODE_ENV=production`
- **THEN** besteht jede Logzeile aus genau einem JSON-Objekt
