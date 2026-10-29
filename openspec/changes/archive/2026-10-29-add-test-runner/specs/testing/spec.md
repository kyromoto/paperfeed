# Spec Delta

## Purpose
Beschreibt, wie automatisierte Tests im Projekt abgelegt, ausgeführt und in der CI erzwungen werden, damit Änderungen ohne manuelle Regressionsprüfung abgesichert sind.

## ADDED Requirements

### Requirement: Tests ausführen
Das System SHALL über `npm test` alle Testdateien `src/**/*.test.ts` einmalig ausführen und bei mindestens einem fehlgeschlagenen Test mit einem Exit-Code ungleich 0 enden.

#### Scenario: Alle Tests bestehen
- **WHEN** `npm test` ausgeführt wird und alle Tests bestehen
- **THEN** endet der Befehl mit Exit-Code 0

#### Scenario: Ein Test schlägt fehl
- **WHEN** ein Test fehlschlägt
- **THEN** endet `npm test` mit einem Exit-Code ungleich 0 und nennt den fehlgeschlagenen Test

### Requirement: Tests neben dem Code, nicht im Build
Das System SHALL Tests als `*.test.ts` neben dem getesteten Modul ablegen und SHALL sie vom Produktions-Build und vom Docker-Image ausschließen, während `tsc --noEmit` sie weiterhin typprüft.

#### Scenario: Build ohne Tests
- **WHEN** `npm run build` ausgeführt wird
- **THEN** enthält `build/` keine Testdateien

#### Scenario: Typfehler im Test
- **WHEN** ein Test einen Typfehler enthält
- **THEN** meldet `npx tsc --noEmit` den Fehler

### Requirement: Tests ohne externe Dienste
Das System SHALL Tests so gestalten, dass sie weder Netzwerk, Redis, Docker noch Google- oder Paperless-Zugriff benötigen. Datenbankzugriffe SHALL gegen eine In-Memory-SQLite-Datenbank laufen.

#### Scenario: Offline-Ausführung
- **WHEN** `npm test` ohne Netzwerk und ohne laufende Container ausgeführt wird
- **THEN** bestehen alle Tests

### Requirement: Tests in der CI
Das System SHALL in der CI-Pipeline `npm test` vor dem Release ausführen, sodass fehlgeschlagene Tests Release und Image-Build verhindern.

#### Scenario: Fehlgeschlagene Tests
- **WHEN** ein Test in der CI fehlschlägt
- **THEN** wird kein Release erzeugt und kein Docker-Image veröffentlicht

### Requirement: Testkonvention
Das System SHALL neue reine Logik und Fehlerbehebungen, die ein spezifiziertes Verhalten betreffen, mit einem automatisierten Test absichern.

#### Scenario: Neue reine Funktion
- **WHEN** eine Change eine neue reine Funktion mit Verzweigungen einführt
- **THEN** enthalten die Tasks der Change einen Test dafür
