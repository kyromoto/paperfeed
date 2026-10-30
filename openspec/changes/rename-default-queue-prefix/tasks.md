# Tasks

## 1. Umsetzung

- [ ] 1.1 `src/types.ts`: Standardwert `.default("paperfeed")` für `queue.redis.prefix`
- [ ] 1.2 `src/config-env.test.ts`: Standardwert `paperfeed`, Überschreiben per `SERVER_QUEUE_REDIS_PREFIX`, leerer Wert liefert den Standard

## 2. Prüfung

- [ ] 2.1 `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec biome ci src`, `pnpm run build`, jeweils mit Exit-Code geprüft
- [ ] 2.2 Lokal mit Redis: App starten, `redis-cli --scan` zeigt Schlüssel für alle vier Queues unter `paperfeed:*` und keine unter dem alten Prefix; mit `SERVER_QUEUE_REDIS_PREFIX=paperless-gdrive-link` liegen sie unter dem alten Prefix

## 3. Dokumentation und Abschluss

- [ ] 3.1 `docs/configuration.md` (Tabelle, Migrationshinweis), README (Bull-Board-Abschnitt, Hinweis zur Umstellung), `.env.example`, `docker-compose.example.yml` (`BULL_PREFIX: paperfeed`)
- [ ] 3.2 Lokale, nicht eingecheckte `docker-compose.yml` des Entwicklers: `BULL_PREFIX` anpassen (nur nach Rückfrage)
- [ ] 3.3 Change archivieren (`openspec archive rename-default-queue-prefix`), Commit als `feat:` mit Hinweis auf die Inkompatibilität im Text
