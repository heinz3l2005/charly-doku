// api/extract.js - Vercel Serverless Function
// Nimmt einen charly-Screenshot (base64) entgegen und klassifiziert grob:
// Behandlung, Datum, Zaehne, Kuerzel, cp (Caries profunda).
// Vorstufe zur interaktiven Materialauswahl im Frontend.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadJson(name) {
  return JSON.parse(readFileSync(join(ROOT, name), "utf8"));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY fehlt in den Vercel-Env-Vars." });

  const { image, mediaType } = req.body || {};
  if (!image) return res.status(400).json({ error: "Kein Bild im Body (Feld 'image' als base64 erwartet)." });

  const bh = loadJson("behandlungen.json");
  const cfg = loadJson("config.json");
  const kz = loadJson("kuerzel.json");
  const MODEL = cfg.modell || "claude-opus-4-8";
  const behandlungenKeys = Object.keys(bh.behandlungen);
  const materialKategorien = Object.keys(bh.materialien);
  const bekannteKuerzel = [
    ...Object.keys(kz.flaechen || {}),
    ...Object.keys(kz.abkuerzungen || {}),
  ];
  const bekannteMaterialien = [];
  for (const kat of materialKategorien) {
    for (const m of bh.materialien[kat]) bekannteMaterialien.push(m.name);
  }

  const system =
    "Du extrahierst strukturiert Daten aus einer charly-Leistungserfassung. Antworte ausschliesslich mit JSON, kein weiterer Text, kein Markdown-Codeblock.";

  const prompt =
    `Lies diesen charly-Ausschnitt und gib NUR JSON zurueck mit folgendem Schema:\n` +
    `{\n` +
    `  "behandlung": <einer der Schluessel: ${behandlungenKeys.join(", ")} oder "unbekannt">,\n` +
    `  "datum": "TT.MM.JJJJ",\n` +
    `  "kuerzel": [<charly-Kuerzel-Strings, z.B. vipr, ubi, l1uk, cp, bmfsep, exc1, iok, ...>],\n` +
    `  "zaehne": [<Zahnnummern im FDI-Schema als Strings>],\n` +
    `  "cp": <true wenn Caries profunda / indirekte Ueberkappung erkennbar, sonst false>,\n` +
    `  "flaechen_pro_zahn": { "<zahn>": "<flaechenkuerzel>" },\n` +
    `  "hat_la": <true wenn eine Anaesthesie-Ziffer/Kuerzel vorhanden (ubi/l1uk/iok/0090/40ok), sonst false>,\n` +
    `  "goz_ziffern": [<GOZ/BEMA-Ziffern die im Screenshot sichtbar sind, z. B. "2080", "13ak", "9040">],\n` +
    `  "materialtext": [<Text/Produktnamen die im Screenshot als Material/Charge auftauchen, z.B. "Cam_ging", "Ubistesin", chargen-artige Kuerzel; auch scheinbar unwichtige. Rohtext.>]\n` +
    `}\n\n` +
    `Wichtig: Auch Kuerzel und Materialtexte listen, die Du selbst nicht kennst - der Backend-Code prueft dann gegen den Katalog.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType || "image/png", data: image } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(502).json({ error: "Anthropic-API-Fehler", detail: err.slice(0, 500) });
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "Klassifikation nicht als JSON parsebar", raw: text });
    }

    // Auto-Erkennung: Kuerzel und Materialtexte, die NICHT im Katalog stehen.
    const norm = (s) => String(s || "").trim().toLowerCase();
    const bekannteKuerzelSet = new Set(bekannteKuerzel.map(norm));
    const bekannteMatSet = new Set(bekannteMaterialien.map(norm));
    const unbekannteKuerzel = (parsed.kuerzel || []).filter(k => k && !bekannteKuerzelSet.has(norm(k)));
    const unbekannteMaterialien = (parsed.materialtext || []).filter(m => m && !bekannteMatSet.has(norm(m)));
    const behandlungUnbekannt = parsed.behandlung === "unbekannt" || !behandlungenKeys.includes(parsed.behandlung);

    parsed.unbekannt = {
      kuerzel: [...new Set(unbekannteKuerzel)],
      materialien: [...new Set(unbekannteMaterialien)],
      behandlung: behandlungUnbekannt,
    };
    parsed.kataloge = {
      materialKategorien,
      behandlungenKeys,
    };

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "Serverfehler", detail: String(e).slice(0, 300) });
  }
}
