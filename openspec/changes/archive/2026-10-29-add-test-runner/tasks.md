# Tasks

## 1. Test-Runner einrichten

- [x] 1.1 `vitest` als Dev-Abhängigkeit mit exakter Version installieren, Scripts `test` (`vitest run src`) und `test:watch` (`vitest src`) in `package.json`
- [x] 1.2 `tsconfig.json`: `include: ["src"]`; neue `tsconfig.build.json` (erweitert `tsconfig.json`, schließt `src/**/*.test.ts` aus); `build`-Script auf `tsc -p tsconfig.build.json`
- [x] 1.3 `Dockerfile`: `tsconfig.build.json` in die Builder-Stage kopieren

## 2. Erste Tests

- [x] 2.1 `src/db.test.ts`: `migrate` auf leerer In-Memory-DB legt beide Tabellen an, ist idempotent und ergänzt eine fehlende Spalte `resource_id`
- [x] 2.2 `src/change-token-repository.test.ts`: get ohne Eintrag, set/get, Überschreiben, Trennung nach Account und Ordner, `delete` (mit und ohne Eintrag)
- [x] 2.3 `src/channel-repository.test.ts`: get ohne Eintrag, upsert/get, Überschreiben, `delete` (mit und ohne Eintrag)

## 3. CI und Prüfung

- [x] 3.1 `.github/workflows/build-and-push.yml`: Schritt `npm test` nach `biome ci`, vor semantic-release
- [x] 3.2 `npm test`, `npx tsc --noEmit`, `npx biome ci src`, `npm run build` (keine Testdateien in `build/`)
- [x] 3.3 Docker-Image bauen und prüfen, dass es keine Testdateien und kein Vitest enthält
- [x] 3.4 Negativprobe: Test absichtlich fehlschlagen lassen, `npm test` endet mit Exit-Code ungleich 0

## 4. Dokumentation und Abschluss

- [x] 4.1 `CLAUDE.md`: Commands (`npm test`, `npm run test:watch`), Hinweis „There is no test suite“ ersetzen, Testkonvention und Ablage
- [x] 4.2 README: kurzer Abschnitt Development (Tests ausführen)
- [x] 4.3 `env-based-config`: Task 3.2 als automatisierte Tests (`src/config-env.test.ts`) formulieren, Abhängigkeit vermerken
- [ ] 4.4 Change archivieren (`openspec archive add-test-runner`), Commit als `chore:` bzw. `test:`
