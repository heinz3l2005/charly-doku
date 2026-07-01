// api/render.js - Vercel Serverless Function
// Rendert den fertigen Karteitext auf Basis des Screenshots + der im Frontend
// getroffenen Auswahl (Behandlung, Materialien, Farbe, Postop-Tag, Extras).

import fs from "node:fs";
import path from "node:path";

export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};

function loadJson(name) {
  const p = path.join(process.cwd(), name);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY fehlt in den Vercel-Env-Vars." });

  const { image, mediaType, behandlung, materialien = {}, farbe, postop_tag, extra = "" } = req.body || {};
  if (!image) return res.status(400).json({ error: "Kein Bild im Body." });
  if (!behandlung) return res.status(400).json({ error: "Feld 'behandlung' fehlt." });

  const bh = loadJson("behandlungen.json");
  const cfg = loadJson("config.json");
  const kz = loadJson("kuerzel.json");
  const MODEL = cfg.modell || "claude-opus-4-8";

  const beh = bh.behandlungen[behandlung];
  if (!beh) return res.status(400).json({ error: `Unbekannte Behandlung: ${behandlung}` });

  const regeln = [
    "Formatiere wichtige Elemente (Zaehne, Materialien, Farbe, Regionen, POD) als **Markdown-Fett**.",
    "Fuellungen als F1 / F2 / F3 (einflaechig / zweiflaechig / dreiflaechig), NIE 'Einfl. Fllg.' o.ae.",
    "Bei zervikalen Fuellungen 'zerv.' vorne setzen und das 'z' pro Flaeche weglassen: F3 zerv. vmd (nicht vzmzdz).",
    "Praeparation NIE als 'adhaesive Praeparation' bezeichnen - nur die Fuellungstechnik ist adhaesiv.",
    "KEINE Patientennamen im Ausgabetext.",
    "Chronologisch, knappe zahnaerztliche Fachsprache.",
    "Erfinde KEINE Befunde/Materialien; was nicht ableitbar ist, bleibt als [Platzhalter: __].",
    "Nur den fertigen Karteitext ausgeben - keine Erklaerung, kein Vorspann, kein Nachsatz.",
    "Behandler-Zeile am Ende als eigene Zeile.",
  ].join("\n- ");

  const kontext =
    `Vorlage der Behandlung "${beh.bezeichnung}":\n${beh.vorlage}\n\n` +
    `Auswahl:\n` +
    `- Materialien: ${JSON.stringify(materialien)}\n` +
    `- Farbe: ${farbe || "-"}\n` +
    `- Postop-Tag: ${postop_tag || "-"}\n` +
    `- Extra-Angaben vom Nutzer: ${extra || "-"}\n` +
    `- Behandler: ${cfg.behandler_standard}\n` +
    `- Charge dokumentieren: ${cfg.charge_dokumentieren}\n\n` +
    `Kuerzel-Nachschlagewerk:\n` +
    `- Flaechen: ${JSON.stringify(kz.flaechen)}\n` +
    `- Abkuerzungen: ${JSON.stringify(kz.abkuerzungen)}\n\n` +
    `Regeln fuer die Ausgabe:\n- ${regeln}`;

  const system =
    "Du erstellst einen deutschen Karteieintrag fuer die charly-Praxissoftware aus einem Bildausschnitt " +
    "der Leistungserfassung und der beigefuegten Auswahl (Materialien, Farbe, POD). " +
    "Halte Dich strikt an die Regeln in der User-Nachricht. Gib NUR den Karteitext aus.";

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
        max_tokens: 1500,
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType || "image/png", data: image } },
              { type: "text", text: kontext },
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

    res.status(200).type("text/plain; charset=utf-8").send(text || "[Keine Antwort erhalten]");
  } catch (e) {
    res.status(500).json({ error: "Serverfehler", detail: String(e).slice(0, 300) });
  }
}
