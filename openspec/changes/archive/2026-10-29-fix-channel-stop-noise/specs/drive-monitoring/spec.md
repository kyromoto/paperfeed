## MODIFIED Requirements

### Requirement: Alten Channel vor dem Neuanlegen stoppen
Das System SHALL beim Start versuchen, den zuvor persistierten Channel über `channels.stop` (mit `channelId` und `resourceId`) zu stoppen und DARF bei Fehlern nicht abbrechen. Antwortet Google mit 404 (Channel unbekannt, bereits gestoppt oder abgelaufen), SHALL das als Normalfall mit Info-Meldung behandelt werden, alle anderen Fehler als Warnung.

#### Scenario: Alter Channel bereits abgelaufen
- **WHEN** `channels.stop` für den persistierten Channel mit 404 antwortet (gestoppt, abgelaufen oder unbekannt)
- **THEN** wird eine Info-Meldung (keine Warnung) geloggt und ein neuer Channel trotzdem angelegt

#### Scenario: Anderer Fehler beim Stoppen
- **WHEN** `channels.stop` aus einem anderen Grund fehlschlägt (z. B. Netzwerkfehler oder 5xx)
- **THEN** wird eine Warnung geloggt und ein neuer Channel trotzdem angelegt

## ADDED Requirements

### Requirement: Channel-Zustand beim Stoppen entfernen
Das System SHALL beim Stoppen eines Monitors (`DriveMonitor.stop()`) den persistierten Channel-Zustand des Accounts löschen, sobald der Channel bei Google gestoppt wurde oder Google mit 404 antwortet. Schlägt das Stoppen aus anderem Grund fehl, SHALL der Zustand erhalten bleiben.

#### Scenario: Geordneter Shutdown
- **WHEN** `stop()` den Channel erfolgreich bei Google stoppt
- **THEN** existiert danach kein Channel-Zustand mehr für den Account und der nächste Start findet keinen vorherigen Channel

#### Scenario: Channel Google unbekannt
- **WHEN** `channels.stop` beim Herunterfahren mit 404 antwortet
- **THEN** wird der Zustand ebenfalls gelöscht

#### Scenario: Stoppen schlägt fehl
- **WHEN** `channels.stop` beim Herunterfahren mit einem Netzwerkfehler fehlschlägt
- **THEN** bleibt der Zustand erhalten, damit der nächste Start den Channel noch stoppen kann

### Requirement: Kompakte Fehlerlogs der Google-API
Das System SHALL Fehler der Google-API beim Starten und Stoppen von Channels mit HTTP-Status, Fehlergrund und Meldung loggen und SHALL nicht das vollständige Fehlerobjekt (Request-Konfiguration, Antwort-Body) ausgeben.

#### Scenario: Fehler beim Stoppen
- **WHEN** `channels.stop` einen Fehler liefert
- **THEN** enthält der Logeintrag Status, Grund und Meldung, aber keine Request-Konfiguration und keine Antwort-Bodys
