# Proposal

## Why

Der Projektinhaber nutzt pnpm in seinen anderen Projekten; ein einheitlicher Paketmanager vereinfacht Wartung, Updates und Wissen über mehrere Repositories. pnpm bringt zusätzlich ein striktes `node_modules` (keine undeklarierten Abhängigkeiten, geprüft: alle Importe in `src/` sind in `package.json` deklariert), ein Lockfile ohne Projektversion (das bisher veraltete `package-lock.json` zeigte 1.9.1 statt 1.10.0) und standardmäßig blockierte Install-Skripte von Abhängigkeiten.

## What Changes

- **Paketmanager pnpm** (Version 12.16.1, gepinnt über das Feld `packageManager` in `package.json`, Aktivierung per Corepack). `package-lock.json` entfällt, `pnpm-lock.yaml` kommt hinzu und wird committet.
- **Freigabe von Build-Skripten** in `pnpm-workspace.yaml` (`allowBuilds`): `better-sqlite3` und `esbuild` erlaubt, `msgpackr-extract` ausdrücklich nicht (optionale Beschleunigung von BullMQ, pnpm 12 bricht sonst mit `ERR_PNPM_IGNORED_BUILDS` ab). Ohne Freigabe von `better-sqlite3` würde die App erst zur Laufzeit scheitern.
- **Dockerfile:** pnpm per Corepack aktivieren, `pnpm install --frozen-lockfile` im Builder, `pnpm install --prod --frozen-lockfile` in der Produktionsstufe, BuildKit-Cache-Mount für den pnpm-Store.
- **CI:** `pnpm/action-setup` vor `actions/setup-node` mit `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm exec biome ci src`, `pnpm test`, `pnpm exec semantic-release`.
- **Dokumentation:** README, `CLAUDE.md` und `docs` von `npm`/`npx` auf `pnpm`/`pnpm exec` umstellen.
- **Specs:** Die Spec `testing` nennt `npm test`, `npm run build` und `npx tsc` ausdrücklich und wird auf pnpm umformuliert. Neue Spec `package-management` hält Paketmanager, reproduzierbare Installation und die Build-Skript-Freigabe fest.

Nicht Teil dieser Change: Ersetzen von `npx @fission-ai/openspec` (bleibt über npm lauffähig), Wechsel der Laufzeit, Umstellung des Release-Prozesses, Distroless.

## Capabilities

### New Capabilities
- `package-management`: Paketmanager, Lockfile, reproduzierbare Installation, Freigabe von Build-Skripten.

### Modified Capabilities
- `testing`: Befehle von `npm`/`npx` auf `pnpm` umgestellt, ohne inhaltliche Änderung der Anforderungen.

## Impact

- Neu: `pnpm-lock.yaml`, `pnpm-workspace.yaml`. Entfernt: `package-lock.json`.
- Geändert: `package.json` (`packageManager`), `Dockerfile`, `.github/workflows/build-and-push.yml`, README, `CLAUDE.md`, `docs/configuration.md` (falls Befehle enthalten), `.gitignore` bei Bedarf.
- Abhängigkeitsversionen werden neu aufgelöst. Die bisher gelösten Versionen werden vorher festgehalten und nach der Migration verglichen, um unbeabsichtigte Upgrades zu erkennen.
- Laufzeitverhalten der App ändert sich nicht. Release als `chore:` (kein Release); das neue Image entsteht beim nächsten `fix:`/`feat:`.
- Risiko: `@semantic-release/npm` ruft intern die npm-CLI auf (nur Versionssetzen, `npmPublish: false`); das lässt sich nur in der echten Pipeline bestätigen.
