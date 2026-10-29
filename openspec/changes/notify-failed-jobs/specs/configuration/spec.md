## MODIFIED Requirements

### Requirement: Server-Konfiguration aus der Umgebung
Das System SHALL den Konfigurationsabschnitt `server` ausschließlich aus Umgebungsvariablen bilden. Der Variablenname ist der Schlüsselpfad in Großbuchstaben, mit `_` verbunden, camelCase-Teile als `SNAKE_CASE`. Pflichtwerte SHALL gesetzt sein, für alle anderen gelten die bisherigen Standardwerte; Zahlenwerte SHALL als Zahl umgewandelt und vom Schema geprüft werden.

#### Scenario: Variablenliste
- **WHEN** die Konfiguration gebildet wird
- **THEN** werden diese Variablen ausgewertet: `SERVER_DATA_PATH`, `SERVER_HTTP_PORT`, `SERVER_QUEUE_REDIS_URL`, `SERVER_QUEUE_REDIS_PREFIX`, `SERVER_QUEUE_CONCURRENCY_COLLECT`, `SERVER_QUEUE_CONCURRENCY_PROCESS`, `SERVER_QUEUE_CONCURRENCY_RENEW`, `SERVER_QUEUE_DEBOUNCE_COLLECT_CHANGES_SEC`, `SERVER_QUEUE_RENEW_POLL_INTERVAL_SEC`, `SERVER_DRIVE_MONITOR_WEBHOOK_URL` und `SERVER_NOTIFICATIONS_WEBHOOK_URL`, davon sind `SERVER_DATA_PATH`, `SERVER_QUEUE_REDIS_URL` und `SERVER_DRIVE_MONITOR_WEBHOOK_URL` Pflicht

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

#### Scenario: Optionaler Benachrichtigungs-Webhook
- **WHEN** `SERVER_NOTIFICATIONS_WEBHOOK_URL` nicht gesetzt ist
- **THEN** ist die Konfiguration gültig und Benachrichtigungen sind ausgeschaltet

#### Scenario: Ungültige Benachrichtigungs-URL
- **WHEN** `SERVER_NOTIFICATIONS_WEBHOOK_URL` keine gültige URL ist
- **THEN** wird die Konfiguration mit einer Meldung abgelehnt, die die Variable nennt und den Wert nicht enthält
