# Design

## Context

- Der Prefix kommt aus `server.queue.redis.prefix` (Zod-Default in `src/types.ts`, Variable `SERVER_QUEUE_REDIS_PREFIX` in `SERVER_VARIABLES`). `createQueues` und die Worker in `main.ts` übergeben ihn an BullMQ, `requeue` in der CLI nutzt denselben Wert.
- Nur der Standardwert wird geändert; die Variable gibt es bereits, sie ist optional, und leere Werte gelten als nicht gesetzt (`composeConfig`).
- Bull Board (`venatum/bull-board`) findet die Queues über `BULL_PREFIX` und sucht Schlüssel `<prefix>:*`; der Wert muss dem der App entsprechen.
- Ein Redis wird nicht notwendigerweise nur von dieser App genutzt (beim Entwickler teilen sich mehrere Projekte einen Redis-Dienst); ein sprechender Prefix macht die Zuordnung erkennbar.

## Goals / Non-Goals

**Goals:**
- Standard-Prefix passt zum Namen der Anwendung.
- Klare Migrationsanleitung für bestehende Deployments.

**Non-Goals:**
- Automatische Migration oder Bereinigung alter Schlüssel, Startwarnung bei Schlüsseln unter dem alten Prefix, Umbenennen der Queues.

## Decisions

1. **Nur den Standardwert ändern** (`.default("paperfeed")` in `src/types.ts`). Die Konfigurationsmechanik (Variable, Leerwert-Behandlung, Weitergabe an BullMQ) bleibt unverändert und ist bereits getestet.
2. **Keine automatische Migration:** Die Datenlage ist unkritisch. Der Startup-Scan stellt alle Dateien im Quellordner neu ein, der Change-Token liegt in SQLite, der Scheduler legt `renew-channel`-Jobs neu an. Verloren gehen noch nicht zugestellte Benachrichtigungen und der Job-Verlauf. Ein Umbenennen der Schlüssel (`RENAME`) während eines laufenden Betriebs wäre riskanter als der Verlust.
3. **Zwei Wege in der Dokumentation:** Wer die Historie behalten will, setzt `SERVER_QUEUE_REDIS_PREFIX=paperless-gdrive-link`. Wer wechseln will, stoppt die App, wartet bis keine Jobs mehr laufen oder warten (Bull Board), aktualisiert und `BULL_PREFIX` des Bull-Board-Containers, und entfernt danach bei Bedarf die alten Schlüssel (`redis-cli --scan --pattern 'paperless-gdrive-link:*'`, danach löschen). Das Löschen übernimmt der Betreiber, nicht die App.
4. **Bull Board neu starten:** Bull Board liest die Queue-Liste nur beim Start; nach dem Prefix-Wechsel (und neuer `BULL_PREFIX`) ist ein Neustart des Containers ohnehin nötig. Das steht im Migrationshinweis.
5. **Tests:** Der bestehende Test auf den Standardwert (`src/config-env.test.ts`) erwartet `paperfeed`; zusätzlich ein Test, dass `SERVER_QUEUE_REDIS_PREFIX=custom` den Wert überschreibt und ein leerer Wert den Standard liefert.

## Risks / Trade-offs

- **Stilles Verwaisen alter Jobs:** Wer den Prefix nicht gesetzt hat und ohne Lesen der Migrationshinweise aktualisiert, hat danach leere Queues in Bull Board (und nicht zugestellte Benachrichtigungen unter dem alten Prefix). Mitigation: Hinweis im README, in `docs/configuration.md` und im Commit-Text. Eine Startwarnung wäre möglich, ist aber nicht Teil dieser Change.
- **Bull Board zeigt nach dem Update nichts an**, wenn `BULL_PREFIX` nicht angepasst wird. Mitigation: gleicher Hinweis.
