# Tasks

## 1. Implementierung

- [ ] 1.1 `describeApiError(error)` in `src/drive-monitor.ts` (Status, Grund, Meldung) und Verwendung statt `{ error: err }` bei Start und Stop
- [ ] 1.2 `start()`: 404 beim Stoppen des vorherigen Channels als Info loggen, andere Fehler als Warnung
- [ ] 1.3 `stop()`: Zustand über `ChannelRepository.delete` entfernen bei Erfolg oder 404, bei anderen Fehlern erhalten und Fehler loggen

## 2. Tests

- [ ] 2.1 `src/drive-monitor.test.ts`: `stop()` erfolgreich löscht den Zustand; `stop()` mit 404 löscht ihn; `stop()` mit Netzwerkfehler behält ihn; `stop()` ohne aktiven Channel ändert nichts
- [ ] 2.2 `start()` mit vorhandenem Zustand und 404: Info statt Warnung, neuer Channel wird angelegt und gespeichert; mit anderem Fehler: Warnung, neuer Channel wird trotzdem angelegt
- [ ] 2.3 Logeinträge enthalten Status/Grund/Meldung, aber nicht das Fehlerobjekt (keine Request-Konfiguration, kein Antwort-Body)

## 3. Prüfung

- [ ] 3.1 `npm test`, `npx tsc --noEmit`, `npx biome ci src`, `npm run build`
- [ ] 3.2 Gegen Docker-Redis und echtes Drive: App starten, stoppen, erneut starten: kein `WARN` zum Channel, `drive_channels` ist nach dem Stoppen leer

## 4. Dokumentation und Abschluss

- [ ] 4.1 `CLAUDE.md`: Channel-Invariante um das Löschen beim Stoppen und die 404-Behandlung ergänzen
- [ ] 4.2 Change archivieren (`openspec archive fix-channel-stop-noise`), Commit als `fix:`
