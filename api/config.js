// api/config.js - liefert die drei JSON-Dateien gebuendelt an das Frontend.
// So bleibt der Katalog serverseitig authoritativ.

import fs from "node:fs";
import path from "node:path";

function loadJson(name) {
  const p = path.join(process.cwd(), name);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export default function handler(_req, res) {
  try {
    const behandlungen = loadJson("behandlungen.json");
    const config = loadJson("config.json");
    const kuerzel = loadJson("kuerzel.json");
    res.status(200).json({ behandlungen, config, kuerzel });
  } catch (e) {
    res.status(500).json({ error: "Config nicht ladbar", detail: String(e).slice(0, 300) });
  }
}
