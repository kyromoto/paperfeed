# Proposal

## Why

Seit der Shutdown geordnet abläuft, stoppt `DriveMonitor.stop()` den Webhook-Channel bei Google. Der Channel-Zustand bleibt dabei in SQLite (`drive_channels`) stehen. Beim nächsten Start versucht `DriveMonitor.start()` deshalb, den bereits gestoppten Channel noch einmal zu stoppen, Google antwortet mit 404 „Channel not found“. Das ist bei jedem Neustart der Normalfall, wird aber als `WARN` geloggt, und zwar mit dem vollständigen Fehlerobjekt der Google-Bibliothek (Request-Konfiguration, Antwort-Body, Retry-Konfiguration): je Account mehrere tausend Zeichen pro Neustart. Echte Warnungen gehen darin unter.

Beobachtet beim Rollout von 1.10.0 auf dem Docker-Host: je Account ein `WARN` „Failed to stop existing channel … not found“ unmittelbar nach dem Start.

## What Changes

- `DriveMonitor.stop()` entfernt den persistierten Channel-Zustand des Accounts, wenn der Channel bei Google gestoppt wurde oder Google ihn nicht mehr kennt (404). Schlägt das Stoppen aus anderem Grund fehl (z. B. Netzwerk), bleibt der Zustand erhalten, damit der nächste Start den Channel noch stoppen kann.
- `DriveMonitor.start()` behandelt ein 404 beim Stoppen des vorherigen Channels als „bereits gestoppt oder abgelaufen“ und loggt es als Info statt als Warnung. Andere Fehler bleiben Warnungen.
- Fehler der Google-API werden in `DriveMonitor` nur noch mit Status, Grund und Meldung geloggt, nicht mehr als vollständiges Fehlerobjekt.
- Tests für `DriveMonitor` (Stoppen/Starten mit gefälschtem Drive-Client und In-Memory-Datenbank).

Nicht Teil dieser Change: Fehlerlogging in anderen Modulen (`queue-utils`, `controllers`, `shutdown`), Verhalten von `reset-channel` in der CLI, Änderungen am Erneuerungsablauf.

## Capabilities

### New Capabilities
<!-- Keine -->

### Modified Capabilities
- `drive-monitoring`: Verhalten beim Stoppen des vorherigen Channels, neues Requirement zum Entfernen des Channel-Zustands beim Stoppen, Logging von API-Fehlern.

## Impact

- Geändert: `src/drive-monitor.ts`, `CLAUDE.md` (Channel-Invariante).
- Neu: `src/drive-monitor.test.ts`.
- Kein Schema-, Config- oder Queue-Einfluss. Release als `fix:` (Patch).
- Betrieb: Beim ersten Start nach dem Update sind noch Zustände von Prozessen ohne geordneten Shutdown möglich, dafür bleibt das Stoppen im Start erhalten.
