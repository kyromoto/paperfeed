# Tasks

## 1. Umsetzung

- [ ] 1.1 `downloadFileFromDrive` (`src/file-processor.ts`): Fehler des Stream-Aufrufs mit `describeApiError` prüfen, Fehler mit numerischem Status unverändert weiterreichen
- [ ] 1.2 Bei Fehler ohne Status Metadaten-Anfrage `files.get({ fileId, fields: "id" })`: deren Fehler werfen, bei Erfolg Fehler mit Dateiname, Datei-ID und Hinweis auf die nicht lesbare Drive-Antwort werfen

## 2. Tests

- [ ] 2.1 `src/file-processor.test.ts` für `downloadFileFromDrive` mit gefälschtem Drive-Client und Fake-`FileStore`: Erfolg (genau ein Drive-Aufruf, Datei im Store), Fehler mit Status unverändert, Stream-Fehler ohne Status mit 404 und 403 in der Diagnose, Diagnose gelingt (Hinweistext), Diagnose scheitert mit Netzwerkfehler

## 3. Prüfung

- [ ] 3.1 `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec biome ci src`, `pnpm run build`
- [ ] 3.2 Einmalig gegen die echte Drive-API mit nicht existierender Datei-ID: Fehlermeldung lautet `File not found: <id>.`
- [ ] 3.3 Optional lokal mit Mini-Webhook und nicht existierender Datei im Job: die Benachrichtigung nennt die Ursache

## 4. Dokumentation und Abschluss

- [ ] 4.1 `CLAUDE.md`: Hinweis zum Stream-Fehler der Drive-Bibliothek bei den Invarianten oder Komponenten
- [ ] 4.2 Change archivieren (`openspec archive explain-drive-download-errors`), Commit als `fix:`
