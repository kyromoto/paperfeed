# Tasks

## 1. Zusammensetzen der Konfiguration

- [ ] 1.1 `src/config-env.ts`: Variablentabelle für `server` (Name, Schlüsselpfad, Typ), Pflichtwerte, Zahlenumwandlung, leere Werte als nicht gesetzt
- [ ] 1.2 Alten `server`-Block in der YAML ablehnen, Fehlermeldung mit Ersatzvariablen (ohne Werte)
- [ ] 1.3 Fehlermeldungen auf Variablennamen und Schlüsselpfade reduzieren (keine Werte, auch nicht aus Zod-Meldungen)
- [ ] 1.4 `ConfigFileRepository.read()` nutzt die Zusammensetzung, `write()` entfernen

## 2. CLI

- [ ] 2.1 `validate-config` nutzt dieselbe Zusammensetzung statt eigenem YAML-Parsing
- [ ] 2.2 Fehlende/ungültige Variablen und alter `server`-Block werden mit Namen ausgegeben, Exit-Codes unverändert

## 3. Prüfung

- [ ] 3.1 `npm test`, `npx tsc --noEmit`, `npx biome ci src`, `npm run build`
- [ ] 3.2 Automatisierte Tests `src/config-env.test.ts` (Vitest, setzt Change `add-test-runner` voraus): alle Variablen gesetzt, nur Pflichtvariablen (Defaults), Pflichtwert fehlt, `SERVER_HTTP_PORT` als Text, leere Variable, ungültige Redis-URL (kein Wert in der Fehlermeldung), alter `server`-Block; zusätzlich `validate-config` einmal von Hand gegen eine Temp-YAML
- [ ] 3.3 App-Start und `healthcheck` mit abweichendem `SERVER_HTTP_PORT` (Docker: Redis), YAML als read-only Mount, Shutdown wie bisher

## 4. Dokumentation und Abschluss

- [ ] 4.1 `docs/configuration.md` anlegen: Quellen-Übersicht, Tabelle aller Umgebungsvariablen (Variable, YAML-Äquivalent, Typ, Pflicht, Default, Beschreibung; inkl. `CONFIG_PATH`, `LOG_LEVEL`, `NODE_ENV`), kurze Erklärung der YAML (`accounts`, `drive_accounts`, `paperless_endpoints` mit Feldern und Beispiel), Migration vom alten `server`-Block, Hinweis auf Compose-Secret für die YAML
- [ ] 4.2 Defaults und Grenzen der Tabelle gegen `src/types.ts` und die Variablentabelle in `src/config-env.ts` abgleichen
- [ ] 4.3 README: Konfigurationsabschnitt auf Kurzfassung reduzieren und auf `docs/configuration.md` verweisen, Migrationshinweis (inkompatible Änderung) hervorheben
- [ ] 4.4 `config.example.yml` ohne `server`-Block, `docker-compose.example.yml` mit den Variablen
- [ ] 4.5 `CLAUDE.md` (Key components, `src/config-env.ts`, Konfigurationsmodell, Pflegeregel für `docs/configuration.md`), `12-FACTOR-REPORT.md` (III mit vermerkter Abweichung, VII, Gesamtergebnis, Reihenfolge), `BACKLOG.md` (Eintrag „Env-basierte Konfiguration“ entfernen)
- [ ] 4.6 Change archivieren (`openspec archive env-based-config`), Commit als `feat:` (kein `BREAKING CHANGE`-Footer, Inkompatibilität im Commit-Text benennen)
