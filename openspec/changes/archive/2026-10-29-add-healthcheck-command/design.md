# Design

## Context

- Der HTTP-Port kommt ausschließlich aus `server.http.port` der YAML (Default 3000, Zod-Schema in `src/types.ts`). Es gibt keine `PORT`-Variable.
- Das Dockerfile hatte `wget … :3000/health` fest verdrahtet.
- Die CLI (`src/cli.ts`) liest die Config bereits über `ConfigFileRepository` und läuft im selben Image.

## Goals / Non-Goals

**Goals:**
- Healthcheck folgt dem konfigurierten Port ohne Dockerfile-Anpassung.

**Non-Goals:**
- Einführung von Umgebungsvariablen für den Port (eigener Backlog-Punkt „Env-basierte Konfiguration“).
- Tiefere Gesundheitsprüfung (Redis, Drive) im Healthcheck.

## Decisions

1. **CLI-Kommando statt Shell-Einzeiler:** `node build/cli.js healthcheck` nutzt Config-Parsing und Zod-Defaults wie die App. Ein `node -e`-Skript im Dockerfile müsste YAML und den Default 3000 duplizieren. Alternative `PORT`-Env verworfen, weil sie den Env-Konfigurations-Umbau vorwegnähme.
2. **Zugriff über `127.0.0.1`:** Der Check läuft im Container der App.
3. **Timeouts:** 4 s für den HTTP-Aufruf, Docker-Timeout 10 s, weil jeder Aufruf einen Node-Start inkl. Config-Laden enthält.
4. **Ausgabe:** `OK <url>` bzw. `FAILED <url>: <Ursache>` auf stdout, sichtbar in `docker inspect`.

## Risks / Trade-offs

- Jeder Check startet einen Node-Prozess (alle 30 s), geringe Last, aber mehr als ein `wget`.
- Fehlt `CONFIG_PATH` im Container, schlägt der Check fehl. Das entspricht dem Verhalten der App.
