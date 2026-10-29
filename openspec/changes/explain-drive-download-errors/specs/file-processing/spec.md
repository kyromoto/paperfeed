## ADDED Requirements

### Requirement: Aussagekräftige Fehler beim Download
Das System SHALL beim Fehlschlagen des Downloads aus Google Drive einen Fehler mit der tatsächlichen Ursache werfen (z. B. `File not found: <id>.`), auch wenn die Drive-Bibliothek die Fehlerantwort eines Streams nicht lesen kann. Fehler, die bereits einen HTTP-Status tragen, SHALL unverändert weitergereicht werden, und im Erfolgsfall SHALL kein zusätzlicher API-Aufruf erfolgen.

#### Scenario: Datei existiert nicht
- **WHEN** der Download einer Datei fehlschlägt, weil die Datei in Drive nicht existiert
- **THEN** lautet die Fehlermeldung des Jobs `File not found: <id>.` und nicht `Cannot read properties of undefined`

#### Scenario: Kein Zugriff
- **WHEN** der Download mit 403 fehlschlägt
- **THEN** nennt die Fehlermeldung die Drive-Ursache (z. B. fehlende Berechtigung)

#### Scenario: Fehler mit HTTP-Status
- **WHEN** die Drive-Bibliothek bereits einen Fehler mit HTTP-Status wirft
- **THEN** wird dieser Fehler unverändert weitergereicht und keine zusätzliche Anfrage gesendet

#### Scenario: Ursache nicht ermittelbar
- **WHEN** der Stream-Download mit einem Fehler ohne Status fehlschlägt und die Metadaten-Anfrage derselben Datei gelingt
- **THEN** nennt der Fehler Dateiname und Datei-ID und weist darauf hin, dass die Drive-Antwort nicht lesbar war

#### Scenario: Erfolgreicher Download
- **WHEN** der Download gelingt
- **THEN** erfolgt genau ein Drive-Aufruf für die Datei und es wird nichts zusätzlich abgefragt
