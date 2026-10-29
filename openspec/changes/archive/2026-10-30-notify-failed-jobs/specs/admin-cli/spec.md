## ADDED Requirements

### Requirement: Testbenachrichtigung senden
Das System SHALL mit `notify-test` eine Testnachricht an den Webhook aus `SERVER_NOTIFICATIONS_WEBHOOK_URL` senden und mit Exit-Code 0 bei Erfolg und 1 bei Fehler beenden. Die Ausgabe SHALL die URL nicht enthalten.

#### Scenario: Webhook erreichbar
- **WHEN** der Webhook die Anfrage mit einem 2xx-Status beantwortet
- **THEN** meldet die CLI `Test notification sent` und beendet sich mit Exit-Code 0

#### Scenario: Webhook nicht konfiguriert
- **WHEN** `SERVER_NOTIFICATIONS_WEBHOOK_URL` nicht gesetzt ist
- **THEN** meldet die CLI, dass keine Benachrichtigungen konfiguriert sind, und beendet sich mit Exit-Code 1

#### Scenario: Webhook nicht erreichbar
- **WHEN** der Webhook nicht antwortet oder einen Fehlerstatus liefert
- **THEN** meldet die CLI den Statuscode bzw. die Fehlerart ohne URL und beendet sich mit Exit-Code 1
