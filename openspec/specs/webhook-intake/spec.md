# webhook-intake Specification

## Purpose
Nimmt Push-Benachrichtigungen von Google Drive an (`POST /webhook`), prüft sie und stellt entprellt einen `collect-changes`-Job ein. Stellt außerdem `GET /health` bereit.

## Requirements

### Requirement: Immer mit 200 antworten
Das System SHALL auf Webhook-Aufrufe mit HTTP 200 antworten, auch bei unbekanntem Channel, ungültigem Token oder internen Fehlern, damit Google nicht erneut zustellt.

#### Scenario: Header fehlen
- **WHEN** `X-Goog-Channel-Id` oder `X-Goog-Resource-State` fehlen
- **THEN** wird die Anfrage mit 200 beantwortet, eine Warnung geloggt und kein Job eingestellt

### Requirement: Channel einem Account zuordnen
Das System SHALL die Anfrage über `X-Goog-Channel-Id` dem Monitor zuordnen, dessen aktueller Channel übereinstimmt.

#### Scenario: Unbekannter Channel
- **WHEN** kein Monitor die Channel-ID besitzt
- **THEN** wird die Anfrage ignoriert (200, Warnung)

### Requirement: Channel-Token prüfen
Das System SHALL `X-Goog-Channel-Token` in konstanter Zeit gegen das Token des Channels prüfen und Anfragen mit fehlendem oder falschem Token ignorieren. Das Token DARF nicht geloggt werden.

#### Scenario: Falsches Token
- **WHEN** der Header fehlt oder nicht übereinstimmt
- **THEN** wird kein Job eingestellt und die geloggten Header enthalten das Token nicht

### Requirement: Sync-Nachricht ignorieren
Das System SHALL Anfragen mit Resource-State `sync` mit 200 beantworten, ohne einen Job einzustellen.

#### Scenario: Channel-Handshake
- **WHEN** Google nach `files.watch` eine `sync`-Nachricht sendet
- **THEN** wird kein `collect-changes`-Job erzeugt

### Requirement: Entprellter collect-changes-Job
Das System SHALL für gültige Anfragen einen `collect-changes`-Job einstellen mit `jobId = collect-changes-{accountId}-{timestamp}`, `deduplication.id = collect-changes-{accountId}` (`ttl`, `extend`, `replace`) und `delay = collectChangesSec * 1000`.

#### Scenario: Mehrere Webhooks in kurzer Folge
- **WHEN** innerhalb des Debounce-Fensters mehrere gültige Webhooks für denselben Account eintreffen
- **THEN** bleibt genau ein Job in der Queue, dessen Ausführung sich jeweils verlängert

### Requirement: Health-Endpoint
Das System SHALL `GET /health` mit Status 200 und `{"status":"OK"}` beantworten.

#### Scenario: Liveness-Check
- **WHEN** `GET /health` aufgerufen wird
- **THEN** antwortet der Server mit 200 und JSON `{"status":"OK"}`
