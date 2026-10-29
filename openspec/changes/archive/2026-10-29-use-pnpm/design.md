# Design

## Context

- Bisher npm: `package-lock.json`, `npm ci` in Dockerfile (Builder und Produktionsstufe) und CI, `npx` für Biome und semantic-release, `setup-node` mit `cache: npm`.
- Basis: `node:24.22.2-alpine3.24`. Corepack ist enthalten (0.36.0), in späteren Node-Versionen wird es nicht mehr mitgeliefert.
- Vorab getestet (Scratch-Verzeichnis, nicht im Repo) mit pnpm 12.16.1 in diesem Image: `pnpm install` ohne Freigabe bricht mit `ERR_PNPM_IGNORED_BUILDS` ab (`better-sqlite3`, `esbuild`, `msgpackr-extract`). `pnpm.onlyBuiltDependencies` in `package.json` wird nicht mehr ausgewertet. `pnpm approve-builds better-sqlite3 esbuild '!msgpackr-extract'` schreibt `pnpm-workspace.yaml` mit `allowBuilds`; danach läuft die Installation durch und `better-sqlite3` öffnet eine In-Memory-Datenbank. Beim Auflösen meldet pnpm außerdem „Lockfile passes supply-chain policies“.
- Alle Importe in `src/` sind in `package.json` deklariert, das strikte `node_modules` bricht also nichts.
- `@semantic-release/git` committet nur `package.json` und `CHANGELOG.md`; `@semantic-release/npm` läuft mit `npmPublish: false`.

## Goals / Non-Goals

**Goals:**
- Einheitlicher Paketmanager mit den anderen Projekten des Inhabers.
- Reproduzierbare Installation lokal, in CI und im Image; dasselbe Laufzeitverhalten wie vorher.
- Native Module funktionieren nachweislich im Produktionsimage.

**Non-Goals:**
- Wechsel von semantic-release, Laufzeit oder Basis-Image, Distroless, Monorepo-Funktionen von pnpm.

## Decisions

1. **Version über `packageManager` pinnen** (`pnpm@12.16.1`) und per Corepack aktivieren (`corepack enable`). Das gilt lokal, im Dockerfile und in der CI (`pnpm/action-setup` liest dasselbe Feld). Alternative `npm i -g pnpm` verworfen, weil dort die Version separat gepflegt werden müsste. Risiko: Corepack ist ab späteren Node-Versionen nicht mehr gebündelt; dann entweder `npm i -g corepack` oder `npm i -g pnpm@<version>` im Dockerfile.
2. **Build-Skripte freigeben, nicht pauschal:** `pnpm-workspace.yaml` mit `allowBuilds`: `better-sqlite3: true`, `esbuild: true`, `msgpackr-extract: false`. `msgpackr-extract` ist eine optionale Beschleunigung von BullMQ (Fallback in reinem JavaScript), muss aber explizit verneint werden, da pnpm 12 sonst abbricht. Neue Pakete mit Install-Skripten erzwingen bewusst eine Entscheidung.
3. **Lockfile-Strenge:** überall `--frozen-lockfile`; im Image zusätzlich `--prod`. Das alte `package-lock.json` wird entfernt.
4. **Dockerfile:** Builder: `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm run build`. Produktionsstufe: `corepack enable`, `pnpm install --prod --frozen-lockfile`. Beide Install-Schritte mit `RUN --mount=type=cache,target=/root/.local/share/pnpm/store` (Store-Pfad beim Umsetzen prüfen). Das Image bleibt Alpine und läuft weiter als root (keine Änderung der Volume-Berechtigungen).
5. **Versionsabgleich:** Vor der Migration die aufgelösten Versionen aus `package-lock.json` exportieren, nach der Migration mit `pnpm-lock.yaml` vergleichen. Abweichungen innerhalb der erlaubten Bereiche sind möglich; größere Sprünge (Major) werden bewusst geprüft. Die Abhängigkeiten sind in `package.json` teils exakt, teils mit Caret gepinnt.
6. **CI:** `pnpm/action-setup` (Version aus `packageManager`) vor `actions/setup-node` mit `cache: pnpm`; Schritte `pnpm install --frozen-lockfile`, `pnpm exec biome ci src`, `pnpm test`, `pnpm exec semantic-release`. `semantic-release` benötigt npm nur für das Setzen der Version; npm ist auf dem Runner vorhanden.
7. **Doku:** `npm run x` wird `pnpm run x` bzw. `pnpm x`, `npx y` wird `pnpm exec y`. Den OpenSpec-CLI-Aufruf lasse ich bei `npx @fission-ai/openspec@1.15.0`, weil das Tool nicht Teil des Projekts ist; wer will, nutzt `pnpm dlx`.
8. **Specs:** `testing` auf pnpm umformulieren (inhaltlich unverändert), neue Spec `package-management` mit Paketmanager, reproduzierbarer Installation und Build-Skript-Freigabe. Die Freigabe wird als Anforderung festgehalten, weil ein Fehler dort erst zur Laufzeit auffällt.

## Risks / Trade-offs

- **`better-sqlite3` ohne Binary:** Fehlt die Freigabe, ist die Installation grün und die App scheitert beim Start. Mitigation: Spec-Szenario und Prüfung im Docker-Image (Datenbank öffnen, Container starten, geordneter Shutdown).
- **Neu aufgelöste Versionen:** Mitigation: Abgleich der Versionen vor und nach der Migration, Tests, Build, Container-Lauf.
- **semantic-release in der echten Pipeline:** Nur dort endgültig prüfbar. Mitigation: Schritt nach dem Push beobachten; Rückfall ist ein Revert des Commits.
- **Corepack-Zukunft:** Siehe Entscheidung 1.
- **Mehr Lernaufwand für Beitragende ohne pnpm:** Einmalig `corepack enable`, in der README vermerkt.
