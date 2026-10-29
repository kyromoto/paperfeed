## MODIFIED Requirements

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
