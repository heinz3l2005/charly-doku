// charly-doku-relay.js
// Kleiner lokaler Relay-Dienst: nimmt einen charly-Screenshot entgegen,
// ruft die Claude-Vision-API auf und gibt einen fertigen Karteieintrag als Klartext zurueck.
//
// Setup (auf dem Homeserver / LXC):
//   npm init -y && npm install express multer
//   export ANTHROPIC_API_KEY=sk-ant-...
//   node charly-doku-relay.js
//
// Node >= 18 (fetch ist eingebaut).

const express = require("express");
const multer = require("multer");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6"; // fuer mehr Tiefe: claude-opus-4-8

const SYSTEM_PROMPT = `
Du bist eine zahnmedizinische Dokumentationsassistenz fuer eine deutsche Zahnarztpraxis (Software: charly).
Eingabe: ein Bildausschnitt der Leistungserfassung eines Patienten fuer ein Behandlungsdatum
(GOZ/BEMA-Ziffern, Zahn-/Regionsangaben, Kuerzel).

Aufgabe: Erstelle daraus einen vollstaendigen, formalen Karteieintrag (Behandlungsdokumentation)
in deutscher Sprache, der zu den erfassten Ziffern klinisch passt.

Regeln:
- Gib NUR den Dokumentationstext aus - kein Markdown, keine Sonderzeichen als Ueberschriften,
  keine Erklaerungen, kein Vorspann, kein Nachsatz.
- Dokumentiere ausschliesslich, was aus den Ziffern/Zahnangaben klinisch folgt, plus die
  ueblichen Standardschritte. Erfinde KEINE Befunde, Messwerte, Diagnosen oder Materialien,
  die nicht ableitbar sind.
- Fuer klinisch relevante Details, die die Ziffern NICHT hergeben (z. B. konkreter Befund,
  Anaesthesie-Dosis falls nicht codiert, Drehmoment, Chargen, Aufklaerungsinhalt, Zahnfarbe),
  setze einen Platzhalter in eckigen Klammern, z. B. [Befund: __], [Drehmoment __ Ncm], [Charge: __].
- Nenne KEINE Patientennamen oder Identifikationsdaten im Ausgabetext.
- Uebliche zahnaerztliche Dokumentationssprache, knapp und praezise, chronologische Schritte.
- Wenn der Ausschnitt unleserlich ist oder keine Leistungen erkennbar sind, gib exakt aus:
  [Screenshot nicht auswertbar - bitte Bereich erneut erfassen]
`.trim();

app.post("/doku", upload.single("image"), async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).type("text/plain").send("Server: ANTHROPIC_API_KEY fehlt.");
    if (!req.file) return res.status(400).type("text/plain").send("Kein Bild empfangen.");

    const mediaType = req.file.mimetype || "image/png";
    const base64 = req.file.buffer.toString("base64");

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "Erstelle den Karteieintrag zu den Leistungen in diesem Ausschnitt." },
            ],
          },
        ],
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(502).type("text/plain").send("API-Fehler: " + err.slice(0, 500));
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    res.type("text/plain; charset=utf-8").send(text || "[Keine Antwort erhalten]");
  } catch (e) {
    res.status(500).type("text/plain").send("Serverfehler: " + String(e).slice(0, 300));
  }
});

app.get("/health", (_, res) => res.send("ok"));
app.listen(PORT, () => console.log(`charly-doku-relay laeuft auf :${PORT}`));
