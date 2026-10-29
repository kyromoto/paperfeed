# Proposal

## Why

Das Projekt hat keinen Test-Runner und keine Tests (`CLAUDE.md`: „There is no test suite“). Größere Änderungen (Konfigurationsumbau, spätere Prozesstypen, Ports & Adapters, siehe `CLEAN-ARCHITECTURE-REPORT.md`) laufen deshalb ohne Sicherheitsnetz, Regressionen werden nur manuell gegen Docker gefunden. Die nachfolgende Change `env-based-config` enthält mit `buildRawConfig` reine Logik mit vielen Randfällen, die als automatisierte Tests deutlich billiger und verlässlicher zu prüfen ist als per Handarbeit.

## What Changes

- Vitest als Dev-Abhängigkeit (Version exakt gepinnt), Scripts `npm test` (`vitest run src`) und `npm run test:watch`.
- Tests liegen neben dem Code als `src/**/*.test.ts` und gehören nicht zum Build und nicht ins Docker-Image: neue `tsconfig.build.json` (erweitert `tsconfig.json`, schließt Testdateien aus), `npm run build` nutzt sie, `tsconfig.json` erhält `include: ["src"]` und prüft Tests per `tsc --noEmit` mit. Das `Dockerfile` kopiert die neue Datei in den Builder.
- Erste Tests an vorhandenem, reinem Code ohne Mocks: `ChangeTokenRepository`, `ChannelRepository` und `migrate` gegen eine In-Memory-SQLite-Datenbank (inklusive der `delete`-Methoden).
- CI (`.github/workflows/build-and-push.yml`): `npm test` läuft vor semantic-release, fehlgeschlagene Tests verhindern das Release.
- Dokumentation: `CLAUDE.md` (Commands, Teststrategie und Konvention), README (Abschnitt Development).

Nicht Teil dieser Change: Testabdeckung für Zustandsmaschine, Webhook, Scheduler oder Shutdown (eigene Changes bzw. Teil der jeweiligen Feature-Change), Coverage-Schwellen, Integrationstests gegen Redis/Docker, End-to-End-Tests.

## Capabilities

### New Capabilities
- `testing`: Test-Runner, Ablage und Ausführung der Tests, Einbindung in die CI, Konventionen.

### Modified Capabilities
<!-- Keine -->

## Impact

- Neu: `tsconfig.build.json`, `src/change-token-repository.test.ts`, `src/channel-repository.test.ts`, `src/db.test.ts`.
- Geändert: `package.json` (Scripts, `vitest`), `package-lock.json`, `tsconfig.json`, `Dockerfile`, `.github/workflows/build-and-push.yml`, `CLAUDE.md`, README.
- Produktions-Image und Laufzeitverhalten bleiben unverändert (`npm ci --omit=dev` installiert Vitest nicht).
- Folgechange `env-based-config` setzt diese Change voraus: ihre Fall-Matrix wird als `src/config-env.test.ts` automatisiert.
