# Design

## Context

- `downloadFileFromDrive` ruft `driveClient.files.get({ fileId, alt: "media" }, { responseType: "stream" })` auf und schreibt `res.data` in den `FileStore`.
- Nachgestellt gegen die echte Drive-API mit nicht existierender Datei-ID: Mit `responseType: "stream"` wird ein `TypeError` ohne `status`/`code` geworfen (`Cannot read properties of undefined (reading 'Symbol(Symbol.asyncIterator)')`). Ohne `responseType` wirft dieselbe Anfrage einen API-Fehler mit `status`/`code` 404 und der Meldung `File not found: <id>.`.
- Die Fehlermeldung eines Jobs erscheint im Log, in Bull Board und in der Benachrichtigung bei endgültigen Fehlschlägen.

## Goals / Non-Goals

**Goals:**
- Die Ursache eines fehlgeschlagenen Downloads ist in der Fehlermeldung des Jobs lesbar.
- Kein zusätzlicher API-Aufruf im Erfolgsfall.

**Non-Goals:**
- Fehlermeldungen anderer Schritte, Wiederholungen, anderes Download-Verfahren.

## Decisions

1. **Diagnose nur im Fehlerfall:** Fehler ohne numerischen `status` und `code` gelten als „Fehlerbody nicht lesbar“. Dann folgt eine Metadaten-Anfrage `files.get({ fileId, fields: "id" })` ohne Stream, die den echten API-Fehler liefert. Schlägt sie fehl, wird dieser Fehler geworfen (jeder Fehler der Anfrage, auch ein Netzwerkfehler). Gelingt sie, wird ein neuer Fehler geworfen: `Failed to download <name> (<id>) from Drive: the error response could not be read`. Alternative, vorab immer Metadaten abzufragen, verworfen: ein zusätzlicher API-Aufruf pro Datei im Normalfall, Kontingent und Latenz.
2. **Fehler mit Status unverändert:** Trägt der Fehler bereits `status` oder `code` (Zahl), wird er weitergereicht. Damit bleiben alle bereits aussagekräftigen Fehler (Netzwerkcodes sind Strings, deshalb zählen nur Zahlen) und die Retry-Logik der Bibliothek unberührt. Netzwerkfehler mit String-Code (`ECONNRESET`) tragen keinen numerischen Status: Auch sie lösen die Diagnose aus, die dann den Netzwerkfehler erneut meldet oder gelingt und den allgemeinen Hinweis liefert.
3. **Gleiche Hilfsfunktion wie beim `DriveMonitor`:** `describeApiError` (aus `src/drive-monitor.ts`) liefert `status`; sie wird für die Erkennung wiederverwendet statt eine zweite Logik zu schreiben.
4. **Tests:** `src/file-processor.test.ts` mit gefälschtem Drive-Client und Fake-`FileStore`, nur für `downloadFileFromDrive`: Erfolg (ein Aufruf, Datei im Store), Fehler mit Status (unverändert, ein Aufruf), Stream-Fehler ohne Status mit 404 in der Diagnose, mit 403, Diagnose gelingt (Hinweistext mit Name und ID), Diagnose scheitert mit Netzwerkfehler. Zusätzlich einmalige Prüfung gegen die echte Drive-API (nicht existierende Datei-ID).

## Risks / Trade-offs

- **Ein zusätzlicher API-Aufruf im Fehlerfall:** Vernachlässigbar, nur bei fehlgeschlagenen Downloads.
- **Annahme zum Bibliotheksverhalten:** Die Erkennung beruht darauf, dass die Bibliothek den Stream-Fehlerbody nicht liest. Behebt eine künftige Version das, kommen Fehler mit Status an und werden unverändert weitergereicht. Die Diagnose bleibt dann ungenutzt.
- **Race zwischen Download und Diagnose:** Ändert sich der Zustand der Datei dazwischen (gelöscht, Rechte entzogen), kann die Diagnose eine andere Ursache nennen als der ursprüngliche Fehler. Akzeptiert, die Meldung bleibt für den Betreiber nützlich.
