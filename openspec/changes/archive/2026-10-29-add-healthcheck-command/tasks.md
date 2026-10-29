# Tasks

## 1. Umsetzung

- [x] 1.1 `healthcheck`-Kommando in `src/cli.ts` (Port aus `server.http.port`, Timeout 4 s, Exit 0/1)
- [x] 1.2 `Dockerfile`: `HEALTHCHECK` auf `node build/cli.js healthcheck`, Timeout 10 s

## 2. Prüfung

- [x] 2.1 `tsc`, `biome ci`, Build
- [x] 2.2 Lokal gegen laufende App auf Nicht-Standardport (3456): OK/Exit 0, ohne App FAILED/Exit 1
- [x] 2.3 Docker-Image gebaut, Healthcheck-Eintrag per `docker inspect` geprüft, Kommando im Container liest Port aus gemounteter Config

## 3. Dokumentation und Abschluss

- [x] 3.1 README, `CLAUDE.md`, `12-FACTOR-REPORT.md` (Faktor V) aktualisiert
- [x] 3.2 Change archivieren (`openspec archive add-healthcheck-command`), Requirement in die Baseline übernehmen
