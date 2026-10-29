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
Das System SHALL aus der YAML-Datei nur die Abschnitte `drive_accounts`, `paperless_endpoints` und `accounts` (einschließlich der Zugangsdaten) lesen, den Abschnitt `server` aus der Umgebung ergänzen und erst die zusammengesetzte Konfiguration gegen das Zod-Schema validieren.

#### Scenario: Ungültige Konfiguration
- **WHEN** die Validierung der zusammengesetzten Konfiguration fehlschlägt
- **THEN** wird der Start mit einer Fehlermeldung abgebrochen

#### Scenario: Zugangsdaten in der YAML
- **WHEN** die YAML `private_key` und `password` enthält
- **THEN** werden sie unverändert verwendet

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

### Requirement: Server-Konfiguration aus der Umgebung
Das System SHALL den Konfigurationsabschnitt `server` ausschließlich aus Umgebungsvariablen bilden. Der Variablenname ist der Schlüsselpfad in Großbuchstaben, mit `_` verbunden, camelCase-Teile als `SNAKE_CASE`. Pflichtwerte SHALL gesetzt sein, für alle anderen gelten die bisherigen Standardwerte; Zahlenwerte SHALL als Zahl umgewandelt und vom Schema geprüft werden.

#### Scenario: Variablenliste
- **WHEN** die Konfiguration gebildet wird
- **THEN** werden diese Variablen ausgewertet: `SERVER_DATA_PATH`, `SERVER_HTTP_PORT`, `SERVER_QUEUE_REDIS_URL`, `SERVER_QUEUE_REDIS_PREFIX`, `SERVER_QUEUE_CONCURRENCY_COLLECT`, `SERVER_QUEUE_CONCURRENCY_PROCESS`, `SERVER_QUEUE_CONCURRENCY_RENEW`, `SERVER_QUEUE_DEBOUNCE_COLLECT_CHANGES_SEC`, `SERVER_QUEUE_RENEW_POLL_INTERVAL_SEC` und `SERVER_DRIVE_MONITOR_WEBHOOK_URL`, davon sind `SERVER_DATA_PATH`, `SERVER_QUEUE_REDIS_URL` und `SERVER_DRIVE_MONITOR_WEBHOOK_URL` Pflicht

#### Scenario: Vollständige Server-Konfiguration
- **WHEN** die drei Pflichtvariablen gesetzt sind und `SERVER_HTTP_PORT=8080`
- **THEN** lauscht der Server auf 8080 und alle übrigen Werte haben ihre Standardwerte

#### Scenario: Pflichtwert fehlt
- **WHEN** `SERVER_QUEUE_REDIS_URL` nicht gesetzt ist
- **THEN** bricht der Start mit einer Meldung ab, die diese Variable nennt

#### Scenario: Port ist keine Zahl
- **WHEN** `SERVER_HTTP_PORT=abc`
- **THEN** wird die Konfiguration mit einer Meldung abgelehnt, die den Schlüsselpfad `server.http.port` nennt

#### Scenario: Leerer Wert
- **WHEN** eine Variable leer gesetzt ist
- **THEN** gilt sie als nicht gesetzt

### Requirement: Alten server-Block ablehnen
Das System SHALL die Konfiguration ablehnen, wenn die YAML einen Abschnitt `server` enthält, und die Meldung SHALL die stattdessen zu setzenden Variablennamen nennen, aber keine Werte.

#### Scenario: Alter server-Block
- **WHEN** die YAML noch `server.http.port` enthält
- **THEN** bricht der Start ab und nennt `SERVER_HTTP_PORT` als Ersatz

### Requirement: Keine Werte in Konfigurationsfehlern
Das System SHALL in Fehlermeldungen der Konfigurations-Zusammensetzung nur Variablennamen und Schlüsselpfade nennen, nie Werte (die Redis-URL kann Zugangsdaten enthalten).

#### Scenario: Ungültige Redis-URL
- **WHEN** `SERVER_QUEUE_REDIS_URL` keine gültige URL ist
- **THEN** nennt die Meldung die Variable bzw. den Pfad `server.queue.redis.url` und nicht den Wert

### Requirement: Konfigurationsdatei schreibgeschützt
Das System SHALL die Konfigurationsdatei nur lesen und nie schreiben.

#### Scenario: Read-only Mount
- **WHEN** die Konfigurationsdatei als schreibgeschützter Mount bereitgestellt ist
- **THEN** funktionieren App und CLI unverändert
