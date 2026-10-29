# Proposal

## Why

Das Docker-`HEALTHCHECK` enthielt den Port 3000 fest, obwohl der Port über `server.http.port` in der YAML-Konfiguration eingestellt wird. Bei abweichendem Port meldete der Container dauerhaft „unhealthy“. Der Port steht in keiner Umgebungsvariable, daher kann das Dockerfile ihn nicht selbst kennen. (Faktor V/VII, siehe `12-FACTOR-REPORT.md`.)

**Nachträgliche Dokumentation:** Die Umsetzung (Commit `4859925`) und das Requirement wurden zuvor am OpenSpec-Prozess vorbei direkt in `openspec/specs/admin-cli/spec.md` ergänzt. Diese Change holt den Prozess nach: Die Spec-Ergänzung wurde zurückgenommen und kommt durch das Archivieren dieser Change wieder in die Baseline.

## What Changes

- Neues CLI-Kommando `healthcheck` in `src/cli.ts`: ruft `GET http://127.0.0.1:{server.http.port}/health` auf (Timeout 4 s), Exit-Code 0 bei Erfolg, 1 bei Fehler.
- `Dockerfile`: `HEALTHCHECK` ruft `node build/cli.js healthcheck` auf, Timeout auf 10 s erhöht (Node-Start und Config-Laden pro Check).
- Dokumentation (README, `CLAUDE.md`, `12-FACTOR-REPORT.md`) entsprechend.

## Capabilities

### New Capabilities
<!-- Keine -->

### Modified Capabilities
- `admin-cli`: neues Requirement „Healthcheck“.

## Impact

- Geändert: `src/cli.ts`, `Dockerfile`, README, `CLAUDE.md`, `12-FACTOR-REPORT.md`.
- Keine neuen Abhängigkeiten, keine Änderung am Verhalten der App selbst.
- Betrieb: Der Container-Healthcheck liest `CONFIG_PATH` wie die App; ohne gemountete Config schlägt er fehl.
