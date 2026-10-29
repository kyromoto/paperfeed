# Proposal

## Why

Der gesamte `server`-Block (Port, Redis, Webhook-URL, Datenpfad, Queue-Tuning) steht in der YAML-Datei. Das sind Deploy-abhängige Werte und gehören nach Faktor III der Twelve-Factor-App in die Umgebung (siehe `12-FACTOR-REPORT.md`). Die Account-Konfiguration (`accounts`, `drive_accounts`, `paperless_endpoints`) bleibt dagegen bewusst in der YAML, inklusive Zugangsdaten: Sie ist eine schreibgeschützte, erst beim Deployment eingehängte Datei außerhalb des Repos.

## What Changes

**BREAKING (ohne Übergangsphase):** Der Abschnitt `server` wird ausschließlich aus Umgebungsvariablen gebildet.

- Die Hierarchie bleibt im Variablennamen erhalten (Pfad in Großbuchstaben, mit `_` verbunden, camelCase als `SNAKE_CASE`), z. B. `server.http.port` → `SERVER_HTTP_PORT`, `server.queue.redis.url` → `SERVER_QUEUE_REDIS_URL`, `server.drive_monitor.webhook_url` → `SERVER_DRIVE_MONITOR_WEBHOOK_URL`.
- Pflicht: `SERVER_DATA_PATH`, `SERVER_QUEUE_REDIS_URL`, `SERVER_DRIVE_MONITOR_WEBHOOK_URL`. Alle anderen Werte behalten ihre bisherigen Standardwerte.
- `accounts`, `drive_accounts` und `paperless_endpoints` bleiben unverändert in der YAML (`CONFIG_PATH`), einschließlich `private_key` und `password`. Es gibt keine `*_FILE`-Variablen.
- Enthält die YAML noch einen Abschnitt `server`, bricht der Start mit einer Meldung ab, die die zu setzenden Variablen nennt.
- `validate-config` prüft die zusammengesetzte Konfiguration und meldet fehlende oder ungültige Variablen mit Namen.
- Neues Verzeichnis `docs/` mit `docs/configuration.md`: tabellarische Referenz aller Umgebungsvariablen (Variable, entsprechender YAML-Pfad, Typ, Pflicht, Default, Beschreibung) und eine kurze, pragmatische Erklärung der YAML-Konfiguration (Struktur, Felder, Beispiel, Migration vom alten `server`-Block). Das README verweist darauf, statt die Tabellen zu duplizieren.
- Die ungenutzte Methode `ConfigFileRepository.write()` entfällt (Datei ist schreibgeschützt gedacht).
- Release: Der Commit wird als `feat:` ohne `BREAKING CHANGE`-Footer erstellt, es entsteht ein Minor-Release. Die Inkompatibilität wird deshalb in README und Migrationsanleitung deutlich dokumentiert.

Nicht Teil dieser Change: `*_FILE`-Unterstützung, Secrets in der Umgebung, Account-Topologie in Env, Verschlüsselung, Umzug von SQLite nach Redis, Swarm Secrets.

**Voraussetzung:** Die Change `add-test-runner` ist umgesetzt und archiviert; die Prüfung der Zusammensetzung läuft als automatisierte Tests.

## Capabilities

### New Capabilities
<!-- Keine -->

### Modified Capabilities
- `configuration`: `server`-Abschnitt nur aus der Umgebung, YAML nur für Accounts, Migrationsfehler, Datei nur lesend.
- `admin-cli`: `validate-config` prüft die zusammengesetzte Konfiguration.

## Impact

- Neu: `src/config-env.ts` (Variablentabelle, Zusammensetzen des `server`-Blocks).
- Neu: `docs/configuration.md`.
- Geändert: `src/config-repository.ts` (nutzt die Zusammensetzung, `write()` entfällt), `src/cli.ts` (`validate-config`), README, `config.example.yml`, `docker-compose.example.yml`, `CLAUDE.md`, `12-FACTOR-REPORT.md`, `BACKLOG.md`.
- Zod-Schema `Config` und alle Verbraucher bleiben unverändert.
- Keine neuen Abhängigkeiten.
- **Migration bestehender Deployments:** Werte des `server`-Blocks als Variablen setzen und den Block aus der YAML entfernen. Healthcheck, `docker exec … cli` und weitere Container benötigen dieselben Variablen wie die App. Praktischer Hinweis für einen Docker-Host: Die komplette YAML (mit Secrets) lässt sich als Compose-Secret (`/run/secrets/…`) mit `CONFIG_PATH` darauf einhängen.
