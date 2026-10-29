# Design

## Context

- `DriveMonitor.start()` liest den persistierten Zustand (`ChannelRepository.get`), stoppt best-effort den alten Channel und legt einen neuen an (`upsert`). `stop()` stoppt den aktuellen Channel, löscht den Zustand aber nicht.
- Vor der Shutdown-Change wurde `stop()` im Betrieb nie wirksam aufgerufen, der Zustand war beim Start deshalb praktisch immer ein „echter“ Rest eines abgebrochenen Prozesses. Mit geordnetem Shutdown ist der Zustand beim Start dagegen meist bereits gestoppt.
- Google antwortet auf `channels.stop` für unbekannte, gestoppte oder abgelaufene Channels mit HTTP 404 (`reason: notFound`).
- Die Google-Bibliothek (Gaxios) wirft Fehler mit `config`, `response` und `retryConfig`. Mit `{ error: err }` landen sie vollständig im Log.

## Goals / Non-Goals

**Goals:**
- Normalfall (Neustart nach geordnetem Shutdown) ohne Warnung und ohne unnötiges API-Gespräch.
- Echte Fehler beim Stoppen bleiben sichtbar und der Rest-Channel wird später noch erreicht.
- Kompakte, lesbare Fehlerlogs für Channel-Aufrufe.

**Non-Goals:**
- Fehlerlogging in anderen Modulen, `reset-channel` der CLI, Erneuerungsablauf, Änderungen am Schema.

## Decisions

1. **Zustand in `stop()` löschen, nicht nur Warnung abschwächen:** Beides zusammen. Das Löschen vermeidet den überflüssigen zweiten `channels.stop`-Aufruf im Normalfall; die 404-Behandlung in `start()` fängt die Fälle ab, in denen der Zustand trotzdem veraltet ist (Prozess ohne geordneten Shutdown beendet, Channel abgelaufen, während die App aus war).
2. **Wann gelöscht wird:** nach erfolgreichem `channels.stop` oder bei 404. Bei Netzwerkfehlern/5xx bleibt der Zustand, damit `start()` es beim nächsten Mal erneut versucht. Der Channel läuft spätestens nach `channel_expiration_sec` ohnehin ab.
3. **404-Erkennung:** `error.code === 404 || error.status === 404` (Gaxios setzt beides). Kein Abgleich mit dem Meldungstext.
4. **Kompakter Fehler:** kleine Funktion `describeApiError(error)` in `src/drive-monitor.ts` (nur dort benötigt) liefert `{ status, reason, message }` (`reason` aus `response.data.error.errors[0].reason`, falls vorhanden). Sie wird als Log-Property statt des Fehlerobjekts verwendet. Eine Verallgemeinerung auf andere Module bleibt einer eigenen Change vorbehalten.
5. **Verhalten bei `stop()` ohne aktiven Channel** (`channelId` oder `resourceId` fehlen) bleibt unverändert: Warnung, keine Löschung, kein Fehler. Der persistierte Zustand eines nie gestarteten Monitors wird nicht angefasst.
6. **Tests:** `src/drive-monitor.test.ts` mit `vi.mock("./lib")` (liefert einen gefälschten Drive-Client mit `channels.stop` und `files.watch`), echtes `ChannelRepository` auf In-Memory-SQLite (`migrate`) und einem aufzeichnenden Logger-Stub.

## Risks / Trade-offs

- **Zustand verloren, Channel noch aktiv:** Wird der Zustand gelöscht, obwohl Google den Channel noch führt (nur bei 404 ausgeschlossen), könnte ein Channel unkontrolliert weiterlaufen. Mitigation: Löschen nur bei Erfolg oder 404; Channels laufen ohnehin ab.
- **Parallele Prozesse:** Läuft kurz ein zweiter Prozess gegen dieselbe Datenbank (z. B. beim Rolling Restart), kann `stop()` des alten Prozesses den Zustand des neuen löschen. Der Zustand wird nach `start()` des neuen Prozesses per `upsert` geschrieben und beim nächsten Erneuerungs-Poll wieder korrekt angelegt, Single-Instance-Betrieb ist ohnehin die Annahme (`CLAUDE.md`).
- **Fehlerdetails gehen verloren:** Ohne vollständiges Fehlerobjekt fehlt bei seltenen Fehlern Kontext. Mitigation: Status, Grund und Meldung genügen für Google-Fehler; bei `LOG_LEVEL=debug` bleibt die Möglichkeit, das Objekt später gezielt wieder aufzunehmen.
