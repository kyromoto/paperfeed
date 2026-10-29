# Design

## Context

- Der Quellcode ist CommonJS-TypeScript (`module: commonjs`, `rootDir: ./src`, `outDir: ./build`), `tsconfig.json` hat kein `include`. `npm run build` ruft `tsc` auf, das `Dockerfile` kopiert `tsconfig.json` und `src` in den Builder.
- Biome prüft `src` (`biome ci src` in der CI). Node 22.23.4 (Image) und Vitest verlangt `^22.12`.
- Die CI-Pipeline läuft in einem Job: `npm ci`, `biome ci`, semantic-release, danach Docker-Build und Push.
- Es gibt `better-sqlite3` (native Modul), das mit `:memory:` ohne Dateisystem auskommt.

## Goals / Non-Goals

**Goals:**
- Schneller, lokaler und CI-tauglicher Test-Runner ohne externe Dienste.
- Tests nicht im Build und nicht im Image, aber typgeprüft.
- Erste echte Tests an vorhandenem Code als Beleg und Vorlage.

**Non-Goals:**
- Coverage-Schwellen, Integrationstests mit Redis/Docker, Tests für Zustandsmaschine/Webhook/Scheduler/Shutdown.

## Decisions

1. **Vitest statt `node:test`:** Mocks für Module, Timer und Dateisystem (nötig für Scheduler, Shutdown, `_FILE`-Handling), Watch-Modus und gute Fehlerausgabe. `node --import tsx --test` ohne neue Abhängigkeit wäre für reine Logik ausreichend, würde bei Mocks aber früher an Grenzen stoßen. Version wird bei der Installation exakt gepinnt (aktuell 5.0.5).
2. **Keine Vitest-Konfigurationsdatei:** Die Standardwerte genügen (`vitest run src` findet `*.test.ts`). Eine `vitest.config.ts` außerhalb von `src` würde `tsc` mit `rootDir` in Konflikt bringen. Wird später eine Konfiguration nötig, kommt sie mit einer Change dafür.
3. **Ablage:** `src/<modul>.test.ts` neben dem Modul. Das passt zur flachen `src/`-Struktur und zu `biome ci src`. Alternative `test/`-Verzeichnis verworfen, weil es `rootDir` verletzt oder ein eigenes tsconfig bräuchte.
4. **Typprüfung vs. Build:** `tsconfig.json` bekommt `include: ["src"]` (damit Dateien außerhalb von `src` nicht stören) und prüft Tests per `tsc --noEmit` mit. Neue `tsconfig.build.json` erweitert sie und schließt `src/**/*.test.ts` aus; `npm run build` ruft `tsc -p tsconfig.build.json` auf. Das `Dockerfile` kopiert die zusätzliche Datei in den Builder. Das Produktions-Image enthält Vitest und Tests nicht (`npm ci --omit=dev`, Build ohne Tests).
5. **Erste Tests:** `ChangeTokenRepository`, `ChannelRepository` und `migrate` gegen `new Database(":memory:")` aus `better-sqlite3`: Setzen/Lesen/Überschreiben/Löschen, Idempotenz der Migration, Ergänzen der Spalte `resource_id`. Kein Mock nötig, prüft echtes Verhalten und die `delete`-Methoden der CLI.
6. **CI-Schritt:** `npm test` nach `biome ci`, vor semantic-release. Fehlschlag bricht den Job, somit auch Release und Image-Push.
7. **Konvention:** Reine Logik und Fehlerbehebungen mit spezifiziertem Verhalten bekommen einen Test. Als Teil des Specs und in `CLAUDE.md` festgehalten, nicht als harte Pflicht (keine Coverage-Schwelle).

## Risks / Trade-offs

- **Native Abhängigkeit in Tests:** `better-sqlite3` muss für die Test-Umgebung gebaut vorliegen (ist es bereits wegen der App). In der CI läuft `npm ci` wie bisher.
- **Neue Dev-Abhängigkeit (Vitest-Baum):** mehr Installationszeit in CI und Builder-Stage; Produktionsimage unberührt. Mitigation: gepinnte Version.
- **Geänderter Build:** `npm run build` nutzt jetzt `tsconfig.build.json`; vergessen, die Datei im Dockerfile zu kopieren, bricht den Image-Build. Mitigation: Docker-Build ist Teil der Prüfung.
- **Geringe anfängliche Abdeckung:** Zunächst nur Repositories und Migration; der Mehrwert wächst mit den folgenden Changes.
