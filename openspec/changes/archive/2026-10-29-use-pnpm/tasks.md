# Tasks

## 1. Migration

- [x] 1.1 Aufgelöste Versionen aus `package-lock.json` festhalten (Vergleichsbasis)
- [x] 1.2 `packageManager: pnpm@12.16.1` in `package.json` setzen, `corepack enable`, `pnpm import` bzw. `pnpm install` erzeugt `pnpm-lock.yaml`
- [x] 1.3 `pnpm-workspace.yaml` mit `allowBuilds` (`better-sqlite3`, `esbuild` erlaubt, `msgpackr-extract` nicht)
- [x] 1.4 `package-lock.json` entfernen, Versionen vor und nach vergleichen, Abweichungen bewerten (Major-Sprünge prüfen) (21 Abweichungen, alle transitiv/dev: u. a. rolldown 1.2.16→1.2.15, @types/estree 1.0.10→1.0.9, p-map 7.0.3→7.0.4; direkte Abhängigkeiten unverändert)

## 2. Docker

- [x] 2.1 `Dockerfile`: Corepack aktivieren, `pnpm install --frozen-lockfile` (Builder), `pnpm install --prod --frozen-lockfile` (Produktion), BuildKit-Cache-Mount für den pnpm-Store, `pnpm-lock.yaml` und `pnpm-workspace.yaml` kopieren statt `package-lock.json`
- [x] 2.2 Image bauen und prüfen: kein Vitest/TypeScript im Image, `better-sqlite3` lädt, Container startet, wird `healthy`, geordneter Shutdown mit Exit 0

## 3. CI

- [x] 3.1 `.github/workflows/build-and-push.yml`: `pnpm/action-setup`, `setup-node` mit `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm exec biome ci src`, `pnpm test`, `pnpm exec semantic-release`
- [x] 3.2 Den Workflow lokal soweit nachstellen wie möglich (`pnpm install --frozen-lockfile && pnpm exec biome ci src && pnpm test && pnpm run build`)

## 4. Prüfung

- [x] 4.1 `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec biome ci src`, `pnpm run build` (keine Testdateien in `build/`)
- [x] 4.2 Negativprobe: Lockfile bewusst veralten lassen, `pnpm install --frozen-lockfile` schlägt fehl; neue Abhängigkeit mit Install-Skript ohne Freigabe bricht ab
- [x] 4.3 `pnpm run dev` und `pnpm run cli -- validate-config` lokal ausführen (`pnpm run dev` nicht gestartet: die lokale `.env`/Config nutzt noch den alten `server`-Block und echtes Drive; `pnpm run cli` geprüft)

## 5. Dokumentation und Abschluss

- [x] 5.1 README, `CLAUDE.md`, `docs/configuration.md`: Befehle von npm/npx auf pnpm umstellen, Hinweis `corepack enable`
- [x] 5.2 Specs: `testing` angepasst, `package-management` neu (über das Archivieren der Change)
- [ ] 5.3 Change archivieren (`openspec archive use-pnpm`), Commit als `chore:`
- [ ] 5.4 Nach dem Push die erste Pipeline beobachten (semantic-release, Image-Build), bei Fehlern Revert
