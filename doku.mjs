// doku.mjs - optionaler CLI-Runner (ohne Claude Code nutzbar)
// Ablauf: Bild -> Vision klassifiziert Behandlung/Zaehne/Flaechen -> interaktive Auswahl
//         Material/Farbe -> zweiter API-Call rendert den Karteitext.
//
// Setup:  Node >= 18,  export ANTHROPIC_API_KEY=sk-ant-...
// Start:  node doku.mjs pfad/zum/screenshot.png
//
// Hinweis: Screenshot ohne Patientenkopf (Datenschutz). Ausgabe landet in ausgabe.txt.

import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
const bh = JSON.parse(fs.readFileSync("behandlungen.json", "utf8"));
const kz = JSON.parse(fs.readFileSync("kuerzel.json", "utf8"));
const MODEL = cfg.modell || "claude-sonnet-4-6";

const imgPath = process.argv[2];
if (!API_KEY) exit("ANTHROPIC_API_KEY fehlt.");
if (!imgPath || !fs.existsSync(imgPath)) exit("Bildpfad fehlt oder nicht gefunden.");

function exit(m) { console.error(m); process.exit(1); }

async function api(messages, system, maxTokens = 1200) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!r.ok) exit("API-Fehler: " + (await r.text()).slice(0, 400));
  const d = await r.json();
  return (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

function imageBlock() {
  const b64 = fs.readFileSync(imgPath).toString("base64");
  const mt = imgPath.toLowerCase().endsWith(".jpg") || imgPath.toLowerCase().endsWith(".jpeg") ? "image/jpeg" : "image/png";
  return { type: "image", source: { type: "base64", media_type: mt, data: b64 } };
}

async function select(rl, frage, optionen, standard) {
  console.log("\n" + frage);
  optionen.forEach((o, i) => console.log(`  ${i + 1}) ${o}${o === standard ? "  [Standard]" : ""}`));
  const a = (await rl.question(`Auswahl (Enter = Standard): `)).trim();
  if (!a) return standard ?? optionen[0];
  const n = parseInt(a, 10);
  return Number.isInteger(n) && optionen[n - 1] ? optionen[n - 1] : (standard ?? optionen[0]);
}

const run = async () => {
  // 1) Klassifikation + Extraktion
  const klass = await api(
    [{ role: "user", content: [imageBlock(), { type: "text", text:
      "Lies diesen charly-Ausschnitt. Gib NUR JSON zurueck: " +
      "{\"behandlung\": <einer der Schluessel " + Object.keys(bh.behandlungen).join("/") + " oder 'unbekannt'>, " +
      "\"datum\":\"TT.MM.JJJJ\", \"kuerzel\":[..], \"zaehne\":[..], \"cp\": true/false}. Kein weiterer Text." }] }],
    "Du extrahierst strukturiert Daten aus einer charly-Leistungserfassung. Antworte ausschliesslich mit JSON.",
    400
  );
  let info; try { info = JSON.parse(klass.replace(/```json|```/g, "").trim()); } catch { exit("Konnte Klassifikation nicht lesen:\n" + klass); }

  const rl = readline.createInterface({ input, output });
  let key = info.behandlung;
  if (!bh.behandlungen[key]) {
    key = await select(rl, "Behandlung nicht erkannt - bitte waehlen:", Object.keys(bh.behandlungen), Object.keys(bh.behandlungen)[0]);
  }
  const beh = bh.behandlungen[key];
  console.log(`\nBehandlung: ${beh.bezeichnung}`);

  // 2) Material-Slots interaktiv
  const gewaehlt = {};
  for (const slot of beh.material_slots || []) {
    const bedErfuellt = !slot.nur_wenn_kuerzel ||
      slot.nur_wenn_kuerzel.some(k => (info.kuerzel || []).includes(k)) ||
      (slot.nur_wenn_kuerzel.includes("cp") && info.cp);
    if (slot.optional && !bedErfuellt) continue;
    if (slot.nur_wenn_kuerzel && !bedErfuellt) continue;
    const kat = bh.materialien[slot.kategorie] || [];
    const namen = kat.map(m => m.name);
    const std = (kat.find(m => m.standard) || kat[0] || {}).name;
    gewaehlt[slot.kategorie] = await select(rl, slot.frage, namen, std);
  }

  let farbe = "";
  if (beh.farbe_abfragen) farbe = await select(rl, "VITA-Farbe?", cfg.vita_farben, cfg.farbe_standard);
  rl.close();

  // 3) Rendering (zweiter Call: Bild + Auswahl + Vorlage + Kuerzel)
  const kontext =
    "Vorlage:\n" + beh.vorlage +
    "\n\nGewaehlte Materialien: " + JSON.stringify(gewaehlt) +
    "\nFarbe: " + (farbe || "-") +
    "\nBehandler: " + cfg.behandler_standard +
    "\nCharge dokumentieren: " + cfg.charge_dokumentieren +
    "\nFlaechen-Kuerzel: " + JSON.stringify(kz.flaechen) +
    "\nAbkuerzungen: " + JSON.stringify(kz.abkuerzungen);

  const system =
    "Du erstellst einen deutschen Karteieintrag aus einem charly-Ausschnitt und der Vorlage. " +
    "Ersetze die Platzhalter mit den gewaehlten Materialien/der Farbe und den aus dem Bild erkennbaren " +
    "Zaehnen/Flaechen (Flaechenkuerzel ausschreiben). Erfinde KEINE Befunde/Werte/Materialien - was nicht " +
    "ableitbar oder gewaehlt ist, bleibt als [Platzhalter: __]. Keine Patientennamen. NUR den Klartext, kein Markdown.";

  const text = await api(
    [{ role: "user", content: [imageBlock(), { type: "text", text: kontext }] }],
    system, 1400
  );

  fs.writeFileSync("ausgabe.txt", text, "utf8");
  console.log("\n----- KARTEITEXT (auch in ausgabe.txt) -----\n\n" + text + "\n");
};

run();
