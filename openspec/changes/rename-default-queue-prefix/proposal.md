# Proposal

## Why

Der Standardwert des Redis-Prefix für alle BullMQ-Queues lautet `paperless-gdrive-link`, der alte Projektname. Das Repository und das Image heißen inzwischen `paperfeed`. Der Prefix ist über `SERVER_QUEUE_REDIS_PREFIX` schon heute optional einstellbar; geändert wird nur der Standardwert, damit er zum Namen der Anwendung passt (und in einem gemeinsam genutzten Redis erkennbar ist, welche Schlüssel zu welcher Anwendung gehören).

## What Changes

- Standardwert von `SERVER_QUEUE_REDIS_PREFIX` ist `paperfeed` (bisher `paperless-gdrive-link`). Die Variable bleibt optional; ist sie gesetzt, gilt ihr Wert wie bisher.
- **Inkompatibel für bestehende Deployments, die den Prefix nicht gesetzt haben:** Alle vier Queues (`collect-changes`, `process-changes`, `renew-channel`, `notifications`) liegen nach dem Update unter neuen Redis-Schlüsseln. Jobs und Verlauf unter dem alten Prefix werden nicht mehr gelesen. Wer den alten Prefix behalten will, setzt `SERVER_QUEUE_REDIS_PREFIX=paperless-gdrive-link`.
- Anpassung der Dokumentation, Beispiele und Tests (`docs/configuration.md`, README, `.env.example`, `docker-compose.example.yml`): `BULL_PREFIX` des Bull-Board-Containers muss weiter dem Prefix der App entsprechen.
- Migrationshinweis in der Dokumentation (was beim Wechsel verloren geht, wie man den alten Prefix beibehält oder die alten Schlüssel entfernt).

Nicht Teil dieser Change: automatisches Umbenennen oder Löschen der alten Redis-Schlüssel, eine Warnung beim Start, wenn Schlüssel unter dem alten Prefix existieren, Änderung der Queue-Namen.

## Capabilities

### New Capabilities
<!-- Keine -->

### Modified Capabilities
- `configuration`: neues Requirement zum Queue-Prefix (optional, Standardwert `paperfeed`).

## Impact

- Geändert: `src/types.ts` (Standardwert), `src/config-env.test.ts`, `docs/configuration.md`, README, `.env.example`, `docker-compose.example.yml`.
- Betrieb: Bull Board (`BULL_PREFIX`) und alle weiteren Verbraucher derselben Queues müssen denselben Prefix verwenden. Alte Schlüssel unter `paperless-gdrive-link:*` bleiben in Redis liegen, bis sie entfernt werden.
- Wirkung des Wechsels im laufenden Betrieb (Einschätzung): Wartende oder verzögerte Jobs unter dem alten Prefix gehen verloren. Dateien im Quellordner werden durch den Startup-Scan neu eingestellt; der Change-Token liegt in SQLite; die Kanal-Erneuerung legt der Scheduler neu an. Verloren gehen vor allem noch nicht zugestellte Benachrichtigungen und der Job-Verlauf in Bull Board.
- Release als `feat:` (Minor); die Inkompatibilität wird im Commit-Text und in der Dokumentation benannt (kein `BREAKING CHANGE`-Footer, wie bei der Umstellung auf `SERVER_*`).
