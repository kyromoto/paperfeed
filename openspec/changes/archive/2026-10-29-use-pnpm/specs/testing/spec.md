## MODIFIED Requirements

### Requirement: Tests ausführen
Das System SHALL über `pnpm test` alle Testdateien `src/**/*.test.ts` einmalig ausführen und bei mindestens einem fehlgeschlagenen Test mit einem Exit-Code ungleich 0 enden.

#### Scenario: Alle Tests bestehen
- **WHEN** `pnpm test` ausgeführt wird und alle Tests bestehen
- **THEN** endet der Befehl mit Exit-Code 0

#### Scenario: Ein Test schlägt fehl
- **WHEN** ein Test fehlschlägt
- **THEN** endet `pnpm test` mit einem Exit-Code ungleich 0 und nennt den fehlgeschlagenen Test

### Requirement: Tests neben dem Code, nicht im Build
Das System SHALL Tests als `*.test.ts` neben dem getesteten Modul ablegen und SHALL sie vom Produktions-Build und vom Docker-Image ausschließen, während `tsc --noEmit` sie weiterhin typprüft.

#### Scenario: Build ohne Tests
- **WHEN** `pnpm run build` ausgeführt wird
- **THEN** enthält `build/` keine Testdateien

#### Scenario: Typfehler im Test
- **WHEN** ein Test einen Typfehler enthält
- **THEN** meldet `pnpm exec tsc --noEmit` den Fehler

### Requirement: Tests ohne externe Dienste
Das System SHALL Tests so gestalten, dass sie weder Netzwerk, Redis, Docker noch Google- oder Paperless-Zugriff benötigen. Datenbankzugriffe SHALL gegen eine In-Memory-SQLite-Datenbank laufen.

#### Scenario: Offline-Ausführung
- **WHEN** `pnpm test` ohne Netzwerk und ohne laufende Container ausgeführt wird
- **THEN** bestehen alle Tests

### Requirement: Tests in der CI
Das System SHALL in der CI-Pipeline `pnpm test` vor dem Release ausführen, sodass fehlgeschlagene Tests Release und Image-Build verhindern.

#### Scenario: Fehlgeschlagene Tests
- **WHEN** ein Test in der CI fehlschlägt
- **THEN** wird kein Release erzeugt und kein Docker-Image veröffentlicht
