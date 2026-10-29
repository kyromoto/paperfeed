# Tasks

## 1. Migration

- [ ] 1.1 Aufgelöste Versionen aus `package-lock.json` festhalten (Vergleichsbasis)
- [ ] 1.2 `packageManager: pnpm@12.16.1` in `package.json` setzen, `corepack enable`, `pnpm import` bzw. `pnpm install` erzeugt `pnpm-lock.yaml`
- [ ] 1.3 `pnpm-workspace.yaml` mit `allowBuilds` (`better-sqlite3`, `esbuild` erlaubt, `msgpackr-extract` nicht)
- [ ] 1.4 `package-lock.json` entfernen, Versionen vor und nach vergleichen, Abweichungen bewerten (Major-Sprünge prüfen)

## 2. Docker

- [ ] 2.1 `Dockerfile`: Corepack aktivieren, `pnpm install --frozen-lockfile` (Builder), `pnpm install --prod --frozen-lockfile` (Produktion), BuildKit-Cache-Mount für den pnpm-Store, `pnpm-lock.yaml` und `pnpm-workspace.yaml` kopieren statt `package-lock.json`
- [ ] 2.2 Image bauen und prüfen: kein Vitest/TypeScript im Image, `better-sqlite3` lädt, Container startet, wird `healthy`, geordneter Shutdown mit Exit 0

## 3. CI

- [ ] 3.1 `.github/workflows/build-and-push.yml`: `pnpm/action-setup`, `setup-node` mit `cache: pnpm`, `pnpm install --frozen-lockfile`, `pnpm exec biome ci src`, `pnpm test`, `pnpm exec semantic-release`
- [ ] 3.2 Den Workflow lokal soweit nachstellen wie möglich (`pnpm install --frozen-lockfile && pnpm exec biome ci src && pnpm test && pnpm run build`)

## 4. Prüfung

- [ ] 4.1 `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec biome ci src`, `pnpm run build` (keine Testdateien in `build/`)
- [ ] 4.2 Negativprobe: Lockfile bewusst veralten lassen, `pnpm install --frozen-lockfile` schlägt fehl; neue Abhängigkeit mit Install-Skript ohne Freigabe bricht ab
- [ ] 4.3 `pnpm run dev` und `pnpm run cli -- validate-config` lokal ausführen

## 5. Dokumentation und Abschluss

- [ ] 5.1 README, `CLAUDE.md`, `docs/configuration.md`: Befehle von npm/npx auf pnpm umstellen, Hinweis `corepack enable`
- [ ] 5.2 Specs: `testing` angepasst, `package-management` neu (über das Archivieren der Change)
- [ ] 5.3 Change archivieren (`openspec archive use-pnpm`), Commit als `chore:`
- [ ] 5.4 Nach dem Push die erste Pipeline beobachten (semantic-release, Image-Build), bei Fehlern Revert
