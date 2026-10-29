# admin-cli Specification

## Purpose
Stellt Einmal-Kommandos für Betrieb und Wartung bereit, die im selben Image wie die App laufen und dieselbe Konfiguration verwenden, ohne die App zu starten.

## Requirements

### Requirement: Aufruf und Exit-Codes
Das System SHALL die CLI als `node build/cli.js <kommando> [argumente]` bereitstellen, `CONFIG_PATH`, `LOG_LEVEL` und `NODE_ENV` wie die App auswerten und mit Exit-Code 0 bei Erfolg, 1 bei einem Fehler und 2 bei falscher Bedienung beenden.

#### Scenario: Unbekanntes Kommando
- **WHEN** ein unbekanntes oder fehlendes Kommando übergeben wird
- **THEN** gibt die CLI eine Hilfe mit den verfügbaren Kommandos aus und beendet sich mit Exit-Code 2

#### Scenario: Fehlendes Account-Argument
- **WHEN** `reset-token`, `reset-channel` oder `requeue` ohne Account aufgerufen wird
- **THEN** beendet sich die CLI mit Exit-Code 2 und nennt die erwartete Verwendung

### Requirement: Account auswählen
Das System SHALL Accounts über ihre `id` oder ihren `name` aus der Konfiguration auswählen.

#### Scenario: Unbekannter Account
- **WHEN** weder `id` noch `name` eines Accounts passen
- **THEN** beendet sich die CLI mit Exit-Code 1 und listet die verfügbaren Accounts, ohne Daten zu verändern

### Requirement: Konfiguration prüfen
Das System SHALL mit `validate-config` die zusammengesetzte Konfiguration (YAML für Accounts, Umgebungsvariablen für `server`) gegen das Zod-Schema validieren und prüfen, dass jeder Account auf einen vorhandenen Drive-Account und Paperless-Endpoint verweist und IDs eindeutig sind. Fehlende oder ungültige Variablen SHALL mit ihrem Namen gemeldet werden.

#### Scenario: Gültige Konfiguration
- **WHEN** Schema und Querverweise gültig sind
- **THEN** meldet die CLI Erfolg und beendet sich mit Exit-Code 0

#### Scenario: Ungültige Konfiguration
- **WHEN** das Schema verletzt ist, ein Pflichtwert fehlt oder ein Querverweis fehlt
- **THEN** listet die CLI alle Fehler und beendet sich mit Exit-Code 1

#### Scenario: Alter server-Block
- **WHEN** die YAML noch einen `server`-Block enthält
- **THEN** listet die CLI die zu setzenden Variablennamen und beendet sich mit Exit-Code 1

#### Scenario: Secrets in der Ausgabe
- **WHEN** Fehler oder Erfolg ausgegeben werden
- **THEN** enthalten die Meldungen keine Werte von `private_key`, `password` oder der Redis-URL

### Requirement: Erreichbarkeit prüfen
Das System SHALL mit `validate-config --online` zusätzlich Redis (Ping), pro Account den Zugriff auf Quell- und Zielordner in Google Drive sowie den Login bei Paperless-ngx prüfen und jede Prüfung einzeln mit Ergebnis ausgeben.

#### Scenario: Paperless nicht erreichbar
- **WHEN** der Paperless-Login fehlschlägt oder zeitüberschreitet
- **THEN** wird der Fehler für diesen Account ausgegeben, die übrigen Prüfungen laufen weiter und der Exit-Code ist 1

### Requirement: Migrationen ausführen
Das System SHALL mit `migrate` die SQLite-Migrationen im Verzeichnis `{data_path}/db` ausführen, ohne Redis zu verbinden oder die App zu starten.

#### Scenario: Leeres Datenverzeichnis
- **WHEN** `migrate` auf einem leeren `data_path` läuft
- **THEN** wird `db/paperfeed.db` mit allen Tabellen angelegt

#### Scenario: Wiederholter Aufruf
- **WHEN** `migrate` erneut ausgeführt wird
- **THEN** bleiben Daten unverändert und der Exit-Code ist 0

### Requirement: Change-Token zurücksetzen
Das System SHALL mit `reset-token <account>` den gespeicherten Change-Token des Accounts für dessen Quellordner löschen und darauf hinweisen, dass Änderungen bis zum nächsten Collect nicht nachverfolgt werden und `requeue` diese nachholt.

#### Scenario: Token vorhanden
- **WHEN** ein Token für `(accountId, drive_src_folder_id)` existiert
- **THEN** wird er gelöscht und der nächste `collect-changes`-Lauf holt einen neuen Start-Token

#### Scenario: Kein Token vorhanden
- **WHEN** kein Token gespeichert ist
- **THEN** meldet die CLI, dass nichts zu tun war, und beendet sich mit Exit-Code 0

### Requirement: Webhook-Channel zurücksetzen
Das System SHALL mit `reset-channel <account>` den persistierten Channel des Accounts per `channels.stop` (mit `channelId` und `resourceId`) bei Google stoppen, Fehler dabei nur als Warnung ausgeben und die Zeile in `drive_channels` löschen.

#### Scenario: Channel vorhanden
- **WHEN** ein Channel-Zustand gespeichert ist
- **THEN** wird der Channel gestoppt, der Zustand gelöscht und darauf hingewiesen, dass der Renewal-Poller der laufenden App einen neuen Channel anlegt

#### Scenario: Stop bei Google schlägt fehl
- **WHEN** `channels.stop` einen Fehler liefert (z. B. Channel abgelaufen)
- **THEN** wird der Zustand trotzdem gelöscht und der Exit-Code ist 0

### Requirement: Dateien erneut einstellen
Das System SHALL mit `requeue <account>` alle aktuell im Quellordner des Accounts liegenden Dateien als `process-changes`-Jobs mit denselben `jobId`- und `deduplication.id`-Schemata und Queue-Optionen wie die App einstellen und die Anzahl ausgeben.

#### Scenario: Dateien im Quellordner
- **WHEN** der Quellordner Dateien enthält
- **THEN** wird pro Datei ein Job eingestellt, Dateien mit bereits laufendem Job werden durch Deduplizierung nicht doppelt verarbeitet

#### Scenario: Leerer Quellordner
- **WHEN** keine Dateien vorhanden sind
- **THEN** werden keine Jobs eingestellt und der Exit-Code ist 0

### Requirement: Ressourcen sauber schließen
Das System SHALL nach jedem Kommando geöffnete Verbindungen (SQLite, Redis, Queues) schließen, damit der Prozess ohne Verzögerung endet.

#### Scenario: Kommando beendet
- **WHEN** ein Kommando fertig oder fehlgeschlagen ist
- **THEN** endet der Prozess ohne offene Handles und mit dem passenden Exit-Code

### Requirement: Parallelbetrieb mit laufender App
Das System SHALL die schreibenden Kommandos `reset-token` und `reset-channel` auch bei laufender App erlauben und dabei eine Warnung ausgeben, dass ein gleichzeitig laufender Collect bzw. Monitor betroffen sein kann.

#### Scenario: App läuft
- **WHEN** `reset-token` oder `reset-channel` ausgeführt wird
- **THEN** zeigt die CLI die Warnung und führt die Aktion aus

### Requirement: Healthcheck
Das System SHALL mit `healthcheck` den Endpoint `GET /health` der lokalen App unter `127.0.0.1` auf dem Port `server.http.port` der Konfiguration aufrufen (Timeout 4 s) und mit Exit-Code 0 bei Erfolg und 1 bei Fehler beenden, sodass das Docker-`HEALTHCHECK` keinen festen Port enthalten muss.

#### Scenario: App läuft
- **WHEN** die App auf dem konfigurierten Port antwortet
- **THEN** gibt die CLI `OK <url>` aus und beendet sich mit Exit-Code 0

#### Scenario: App nicht erreichbar
- **WHEN** die Verbindung fehlschlägt oder zeitüberschreitet
- **THEN** gibt die CLI `FAILED <url>` mit der Ursache aus und beendet sich mit Exit-Code 1
