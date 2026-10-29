# Proposal

## Why

Scheitert der Download einer Datei aus Google Drive (Datei nicht gefunden, kein Zugriff, Kontingent), lautet die Fehlermeldung des Jobs immer `Cannot read properties of undefined (reading 'Symbol(Symbol.asyncIterator)')`. Das steht im Log, in Bull Board und seit `notify-failed-jobs` auch in der Matrix-Benachrichtigung, ohne dass man die Ursache erkennt.

Ursache (gegen die echte Drive-API nachgestellt, Datei-ID existiert nicht): Der Download nutzt `files.get(..., { responseType: "stream" })`. Bei einer Fehlerantwort versucht die Google-Bibliothek, den Fehlerbody als Stream zu lesen, und wirft stattdessen einen `TypeError`. Ohne `responseType` liefert dieselbe Anfrage den richtigen Fehler (`File not found: <id>.`, HTTP 404). Betroffen ist jeder Fehlerstatus des Downloads, nicht nur 404.

## What Changes

- `FileProcessor.downloadFileFromDrive` erkennt einen Fehler ohne HTTP-Status (der verschluckte Fehlerbody) und holt die tatsächliche Ursache mit einer Metadaten-Anfrage derselben Datei (`files.get` mit `fields: id`, ohne Stream). Schlägt diese mit einem API-Fehler fehl, wird dieser (z. B. `File not found: <id>.`) als Fehler des Jobs geworfen. Gelingt sie, wird ein Fehler mit Dateiname, Datei-ID und der Hinweis, dass die Drive-Antwort nicht lesbar war, geworfen.
- Fehler, die bereits einen HTTP-Status tragen, werden unverändert weitergereicht, und im Erfolgsfall entsteht kein zusätzlicher API-Aufruf.
- Tests mit gefälschtem Drive-Client und Prüfung gegen die echte Drive-API (bekannte nicht existierende Datei-ID).

Nicht Teil dieser Change: Fehlermeldungen der Paperless-Übertragung und des Verschiebens, Wiederholung fehlgeschlagener Downloads, Umstellung des Downloads auf eine andere Methode.

## Capabilities

### New Capabilities
<!-- Keine -->

### Modified Capabilities
- `file-processing`: neues Requirement zur Aussagekraft von Download-Fehlern.

## Impact

- Geändert: `src/file-processor.ts` (`downloadFileFromDrive`).
- Neu: `src/file-processor.test.ts` (nur der Download-Pfad).
- Keine neuen Abhängigkeiten, kein geändertes Verhalten im Erfolgsfall. Release als `fix:` (Patch).
- Wirkung auf Benachrichtigungen: Die Matrix-Meldung nennt künftig die Ursache (z. B. `File not found: <id>.`).
