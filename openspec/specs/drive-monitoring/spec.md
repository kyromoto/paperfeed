# drive-monitoring Specification

## Purpose
Hält pro Account genau einen Google-Drive-Webhook-Channel auf dem Quellordner aktiv und erneuert ihn rechtzeitig vor Ablauf. Der Channel-Zustand liegt in SQLite (`drive_channels`).

## Requirements

### Requirement: Channel-Zustand persistieren
Das System SHALL nach jedem erfolgreichen `files.watch` den Zustand `{channelId, resourceId, expiration}` pro Account in der Tabelle `drive_channels` speichern.

#### Scenario: Channel gestartet
- **WHEN** `DriveMonitor.start()` einen Channel erfolgreich anlegt
- **THEN** wird der neue Zustand (inkl. `resourceId`) für den Account gespeichert und ersetzt einen vorhandenen

### Requirement: Alten Channel vor dem Neuanlegen stoppen
Das System SHALL beim Start versuchen, den zuvor persistierten Channel über `channels.stop` (mit `channelId` und `resourceId`) zu stoppen und DARF bei Fehlern nicht abbrechen. Antwortet Google mit 404 (Channel unbekannt, bereits gestoppt oder abgelaufen), SHALL das als Normalfall mit Info-Meldung behandelt werden, alle anderen Fehler als Warnung.

#### Scenario: Alter Channel bereits abgelaufen
- **WHEN** `channels.stop` für den persistierten Channel mit 404 antwortet (gestoppt, abgelaufen oder unbekannt)
- **THEN** wird eine Info-Meldung (keine Warnung) geloggt und ein neuer Channel trotzdem angelegt

#### Scenario: Anderer Fehler beim Stoppen
- **WHEN** `channels.stop` aus einem anderen Grund fehlschlägt (z. B. Netzwerkfehler oder 5xx)
- **THEN** wird eine Warnung geloggt und ein neuer Channel trotzdem angelegt

### Requirement: Zufälliges Channel-Token
Das System SHALL für jeden neuen Channel ein zufälliges Token (32 Byte, hex) setzen und nur im Speicher des Monitors halten.

#### Scenario: Neustart
- **WHEN** die App neu startet
- **THEN** wird immer ein neuer Channel mit neuem Token angelegt, das alte Token wird nicht wiederverwendet

### Requirement: Erneuerung per Poller
Das System SHALL in jedem Intervall `renewPollIntervalSec` (Default 15 s) den Channel-Zustand jedes Accounts prüfen und einen `renew-channel`-Job einstellen, wenn kein Zustand existiert oder `expiration - now <= 30 s` gilt.

#### Scenario: Channel läuft bald ab
- **WHEN** die verbleibende Laufzeit höchstens 30 Sekunden beträgt
- **THEN** wird ein `renew-channel`-Job mit `deduplication.id = renew-channel-{accountId}` und `delay: 0` eingestellt

#### Scenario: Erneuerung schlägt fehl
- **WHEN** der `renew-channel`-Job fehlschlägt
- **THEN** wird er bis zu 3 Mal mit exponentiellem Backoff (5 s Basis) wiederholt

### Requirement: Stop ohne aktiven Channel
Das System SHALL `DriveMonitor.stop()` ohne Fehler beenden, wenn kein Channel aktiv ist.

#### Scenario: Shutdown vor dem ersten Channel
- **WHEN** `stop()` aufgerufen wird und `channelId` oder `resourceId` fehlen
- **THEN** wird eine Warnung geloggt und nichts geworfen

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
