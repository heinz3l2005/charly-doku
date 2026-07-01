# charly Karteitext-Assistent

Aus einem charly-Screenshot (Leistungserfassung) wird ein fertiger Karteieintrag.
Standardmaterialien liegen zentral, fehlende Angaben werden per Auswahl abgefragt statt geraten.

## Dateien
- `behandlungen.json` - **die zentrale Datei**: Materialkatalog + je Behandlung Erkennung,
  Material-Slots und Textvorlage
- `config.json` - Behandler, Standardfarbe (A3), Farbliste, Charge an/aus, Modell
- `kuerzel.json` - Aufloesung der charly-Kuerzel (Flaechen + Abkuerzungen)
- `CLAUDE.md` - Anweisung fuer den Claude-Code-Agenten
- `doku.mjs` - optionaler CLI-Runner (ohne Claude Code)

## Zuerst einrichten
1. In `behandlungen.json > materialien` die Eintraege "BITTE EINTRAGEN ..." durch deine
   echten Produkte ersetzen (Komposit, Adhaesiv, Ueberkappung). Je Kategorie genau ein
   `standard: true`.
2. Bei Bedarf `config.json` anpassen (Behandler, Standardfarbe, Charge).

## Nutzung A - in Claude Code (empfohlen)
1. Ordner in Claude Code oeffnen (enthaelt alle Dateien inkl. `CLAUDE.md`).
2. Screenshot der Leistungszeilen (ohne Patientenkopf) ablegen/einfuegen.
3. Claude fragt Material/Farbe per Auswahl ab und gibt den Karteitext aus.
4. Text pruefen, dann in charly einfuegen.

## Nutzung B - CLI
```
export ANTHROPIC_API_KEY=sk-ant-...
node doku.mjs screenshot.png
```
Auswahl im Terminal treffen -> Ergebnis in `ausgabe.txt` und auf der Konsole.

## Datenschutz (wichtig)
- Screenshot **ohne Patientenname/Geburtsdatum** erfassen - nur die Leistungszeilen.
- Vor Produktivbetrieb AVV/DPA mit Anthropic abschliessen, Zero-Data-Retention aktivieren.
- Der Karteieintrag ist ein Rechtsdokument: **vor dem Einfuegen pruefen** (kein Blind-Autotype).

## Bildaufnahme (optional, Windows)
Fuer die automatische Bereichs-Erfassung siehe die separaten Dateien `charly-doku.ahk`
(AutoHotkey) und `charly-doku-relay.js` (Relay-Dienst).

## Nutzung C - Vercel-Web-App

Web-Frontend mit Drag&Drop-Screenshot, Materialauswahl und Copy-Button, das die
gleichen JSON-Konfigurationen verwendet wie die CLI.

### Struktur
- `api/config.js` - liefert `behandlungen.json` + `config.json` + `kuerzel.json`
- `api/extract.js` - Screenshot -> JSON-Klassifikation (Behandlung/Datum/Kuerzel)
- `api/render.js` - Screenshot + Auswahl -> fertiger Karteitext
- `public/index.html` - Frontend (Paste/Drop, Abfrage-Formular, HTML-Copy)
- `vercel.json`, `package.json`, `.gitignore`

### Deploy
1. Repo auf GitHub pushen.
2. In Vercel "New Project" -> Repo waehlen -> deploy.
3. In Project Settings -> Environment Variables:
   - `ANTHROPIC_API_KEY` = dein Anthropic-API-Key
   - optional: `CLAUDE_MODEL` (Default kommt aus `config.json > modell`)
4. Neu deployen. Fertig unter der Vercel-URL.

### Lokal testen
```
npm i -g vercel
vercel dev
```
`vercel dev` reicht Env-Vars aus dem Vercel-Projekt bzw. `.env.local` durch.

### Warnung Datenschutz
Aktuell **kein Zugriffsschutz** - nur fuer erste Tests geeignet, NICHT fuer echte
Patienten-Screenshots. Vor Produktivbetrieb Bearer-Token oder Vercel Password
Protection ergaenzen und AVV/DPA mit Anthropic abschliessen.
```
