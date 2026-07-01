// api/config.js - liefert die drei JSON-Dateien gebuendelt an das Frontend.
// So bleibt der Katalog serverseitig authoritativ.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadJson(name) {
  return JSON.parse(readFileSync(join(ROOT, name), "utf8"));
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
