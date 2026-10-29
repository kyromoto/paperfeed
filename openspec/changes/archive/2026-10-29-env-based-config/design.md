# Design

## Context

- `ConfigFileRepository.read()` parst die YAML und validiert sie sofort mit `Config` (Zod). `validate-config` parst die YAML derzeit selbst. `write()` existiert, wird aber nirgends aufgerufen.
- `src/env.ts` validiert `CONFIG_PATH`, `NODE_ENV`, `LOG_LEVEL` und wirft beim Import.
- Zielumgebung: ein einzelner Docker-Host mit Compose.
- 12-Factor III: Deploy-abhängige Konfiguration gehört in die Umgebung. Entscheidung: Der `server`-Block (feste Skalare) wird Env-only. Die Account-Konfiguration (variable Liste, enthält die Zugangsdaten) bleibt als schreibgeschützte Datei, die erst beim Deployment eingehängt wird. Sie liegt nicht im Repo, der Kerntest „Code ließe sich ohne Geheimnisse veröffentlichen“ ist erfüllt. Strikt gelesen liegen Secrets damit weiter in einer Datei; das ist eine bewusste, im Report vermerkte Abweichung.

## Goals / Non-Goals

**Goals:**
- `server`-Konfiguration ausschließlich aus Umgebungsvariablen, Hierarchie im Namen erhalten.
- Account-Konfiguration unverändert in der YAML.
- Kein stiller Rückfall: alter `server`-Block wird abgelehnt, mit Hinweis auf die Variablen.

**Non-Goals:**
- `*_FILE`, Secrets in der Umgebung, Account-Topologie in Env, Verschlüsselung, Swarm Secrets, Redis-Umzug, Übergangsphase mit Doppelunterstützung.

## Decisions

1. **Zusammensetzen vor der Validierung (`buildRawConfig(yamlObject, env)`).** Neue Datei `src/config-env.ts`: nimmt das geparste YAML-Objekt, baut den Abschnitt `server` aus der Umgebung und gibt das rohe Objekt zurück. Das Zod-Schema `Config` bleibt unverändert, alle Verbraucher sind unberührt. Alternative (Schema mit optionalem `server`, Merge danach) verworfen.
2. **Explizite Variablentabelle** `Variablenname → Schlüsselpfad, Typ (string|number)`, keine automatische Ableitung. Der Name entsteht aus dem Pfad in Großbuchstaben, camelCase als snake (`collectChangesSec` → `COLLECT_CHANGES_SEC`). Die Tabelle vermeidet Mehrdeutigkeit bei Schlüsseln mit Unterstrich (`drive_monitor`, `webhook_url`, `data_path`).
3. **Pflicht und Defaults:** `SERVER_DATA_PATH`, `SERVER_QUEUE_REDIS_URL`, `SERVER_DRIVE_MONITOR_WEBHOOK_URL` sind Pflicht, alles andere behält die Zod-Defaults. Fehlende Pflichtwerte werden mit dem Variablennamen gemeldet (statt als Zod-Pfad). Leere Variablen gelten als nicht gesetzt.
4. **Alten `server`-Block ablehnen:** Enthält die YAML `server`, wirft die Zusammensetzung einen Fehler, der die Variablen auflistet, die zu den vorhandenen Schlüsseln passen. Kein Warnen und Weiterlaufen, damit nie Werte aus zwei Quellen vermischt werden.
5. **Fehlerdisziplin:** Meldungen nennen Variablennamen und Schlüsselpfade, nie Werte (Redis-URLs können Zugangsdaten enthalten). Zod-Meldungen werden vor der Ausgabe auf den Pfad reduziert, die Redaction im Logger bleibt als zweite Schicht.
6. **Alle Verbraucher über `ConfigFileRepository`:** App, `validate-config`, `healthcheck` und übrige CLI-Kommandos nutzen dieselbe Zusammensetzung (statt eigenem YAML-Parsing im CLI). `docker exec … cli` und das Docker-`HEALTHCHECK` laufen im App-Container und erhalten dieselben Variablen.
7. **`ConfigFileRepository.write()` entfernen:** ungenutzt, widerspricht der schreibgeschützten Datei.
8. **Release als `feat:`** ohne `BREAKING CHANGE`-Footer (Entscheidung des Projektinhabers): Es entsteht ein Minor-Release. Die Inkompatibilität ist deshalb in README (Migrationsanleitung) und CHANGELOG-Text des Commits ausdrücklich zu benennen.

13. **Konfigurationsdokumentation in `docs/configuration.md`:** Eine Datei als einzige Referenz für die Konfiguration. Abschnitte: (1) Übersicht der Quellen (Env für `server`, YAML für Accounts), (2) Tabelle aller Umgebungsvariablen mit Spalten Variable, YAML-Äquivalent, Typ, Pflicht, Default, Beschreibung, inklusive `CONFIG_PATH`, `LOG_LEVEL`, `NODE_ENV`, (3) kurze Erklärung der YAML (`accounts`, `drive_accounts`, `paperless_endpoints`: Zweck, Felder, Beispiel mit Platzhaltern), (4) Migration vom alten `server`-Block. Defaults und Grenzen werden aus `src/types.ts` übernommen; das README verweist nur darauf. Damit sie nicht veraltet, verlangt `CLAUDE.md`, die Datei bei jeder Änderung der Konfiguration mitzupflegen. Ein automatischer Abgleich mit der Variablentabelle im Code ist nicht Teil dieser Change.

## Risks / Trade-offs

- **Inkompatible Änderung unter Minor-Version:** Bestehende Deployments starten nach dem Update nicht ohne die neuen Variablen. Mitigation: klare Fehlermeldung mit Ersatzvariablen, Migrationsanleitung im README, `validate-config` vor dem Ausrollen. Wer Images mit `latest` oder Minor-Pinning zieht, wird überrascht.
- **Strikte 12-Factor-Lesart:** Secrets bleiben in einer Datei. Mitigation: Datei nicht im Repo, schreibgeschützt eingehängt (z. B. als Compose-Secret), im Report vermerkt.
- **Keine Tests:** Es gibt keinen Test-Runner. `buildRawConfig` ist rein; Fall-Matrix über `validate-config` mit Temp-Dateien, dazu App-Start gegen Docker.
- **Viele Variablen (10):** Beispiele in `docs/configuration.md` und `docker-compose.example.yml`.
- **Doku kann vom Code abweichen:** Tabelle und Variablentabelle im Code sind zwei Quellen. Mitigation: Pflegeregel in `CLAUDE.md`, Abgleich im Review der Change.
