# Spec Delta

## Purpose
Legt fest, welcher Paketmanager im Projekt verwendet wird und wie Abhängigkeiten lokal, in der CI und im Docker-Image reproduzierbar installiert werden.

## ADDED Requirements

### Requirement: pnpm als Paketmanager
Das System SHALL pnpm als einzigen Paketmanager verwenden. Die Version SHALL über das Feld `packageManager` in `package.json` gepinnt sein, und es SHALL kein `package-lock.json` im Repository existieren.

#### Scenario: Lockfile
- **WHEN** das Repository ausgecheckt wird
- **THEN** enthält es `pnpm-lock.yaml` und kein `package-lock.json`

#### Scenario: Gepinnte Version
- **WHEN** `corepack enable` ausgeführt wird und danach `pnpm -v`
- **THEN** entspricht die Ausgabe der Version in `packageManager`

### Requirement: Reproduzierbare Installation
Das System SHALL Abhängigkeiten in der CI und im Docker-Build ausschließlich mit `pnpm install --frozen-lockfile` installieren, in der Produktionsstufe zusätzlich mit `--prod`, sodass der Build bei abweichendem Lockfile fehlschlägt.

#### Scenario: Lockfile weicht von package.json ab
- **WHEN** `package.json` eine Abhängigkeit enthält, die nicht im Lockfile steht
- **THEN** schlägt die Installation in CI und Docker-Build fehl

#### Scenario: Produktionsimage
- **WHEN** das Docker-Image gebaut wird
- **THEN** enthält es keine Entwicklungsabhängigkeiten (kein Vitest, kein TypeScript)

### Requirement: Explizite Freigabe von Build-Skripten
Das System SHALL Install-Skripte von Abhängigkeiten nur für ausdrücklich freigegebene Pakete zulassen (`allowBuilds` in `pnpm-workspace.yaml`): `better-sqlite3` und `esbuild` erlaubt, `msgpackr-extract` ausdrücklich nicht erlaubt.

#### Scenario: Native Datenbank-Anbindung
- **WHEN** die Abhängigkeiten per pnpm installiert sind
- **THEN** lässt sich `better-sqlite3` laden und eine In-Memory-Datenbank öffnen

#### Scenario: Neue Abhängigkeit mit Install-Skript
- **WHEN** eine neue Abhängigkeit ein Install-Skript mitbringt, das nicht freigegeben ist
- **THEN** bricht die Installation mit einem Hinweis auf die fehlende Freigabe ab
