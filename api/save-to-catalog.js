// api/save-to-catalog.js
// Fuegt neue Materialien / Kuerzel / Behandlungen dauerhaft in behandlungen.json
// bzw. kuerzel.json auf GitHub ein und pusht den Commit - Vercel deployt automatisch.
//
// Erwartet POST-Body:
// {
//   materialien: [{ kategorie: "komposit", name: "Neu XY", standard?: false }],
//   kuerzel:     [{ typ: "flaechen"|"abkuerzungen", key: "xyz", value: "Erklaerung" }],
//   behandlungen:[{ key: "neuebehandlung", bezeichnung: "...", vorlage: "..." }]
// }
//
// Env-Vars die gesetzt sein muessen (Vercel > Project Settings > Environment Variables):
//   GITHUB_TOKEN       - Personal Access Token (fine-grained oder classic) mit Contents: Write
//   GITHUB_REPO_OWNER  - z. B. "heinz3l2005"
//   GITHUB_REPO_NAME   - z. B. "charly-doku"
//   GITHUB_BRANCH      - z. B. "main" (Default: main)

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

const GH_API = "https://api.github.com";

async function getFile(owner, repo, path, branch, token) {
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "charly-doku-save",
    },
  });
  if (!r.ok) throw new Error(`GitHub GET ${path}: ${r.status} ${await r.text()}`);
  const data = await r.json();
  const content = Buffer.from(data.content, "base64").toString("utf8");
  return { content, sha: data.sha };
}

async function putFile(owner, repo, path, branch, token, sha, content, message) {
  const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "charly-doku-save",
    },
    body: JSON.stringify({
      message,
      branch,
      sha,
      content: Buffer.from(content, "utf8").toString("base64"),
    }),
  });
  if (!r.ok) throw new Error(`GitHub PUT ${path}: ${r.status} ${await r.text()}`);
  return await r.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const TOKEN = process.env.GITHUB_TOKEN;
  const OWNER = process.env.GITHUB_REPO_OWNER;
  const REPO = process.env.GITHUB_REPO_NAME;
  const BRANCH = process.env.GITHUB_BRANCH || "main";

  if (!TOKEN || !OWNER || !REPO) {
    return res.status(500).json({
      error: "GitHub-Setup unvollstaendig",
      detail: "Env-Vars GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME muessen in Vercel gesetzt sein.",
    });
  }

  const { materialien = [], kuerzel = [], behandlungen = [] } = req.body || {};

  if (materialien.length === 0 && kuerzel.length === 0 && behandlungen.length === 0) {
    return res.status(400).json({ error: "Nichts zu speichern." });
  }

  const changes = [];

  try {
    // --- behandlungen.json ---
    if (materialien.length > 0 || behandlungen.length > 0) {
      const bhFile = await getFile(OWNER, REPO, "behandlungen.json", BRANCH, TOKEN);
      const bh = JSON.parse(bhFile.content);

      for (const m of materialien) {
        if (!m.kategorie || !m.name) continue;
        if (!bh.materialien[m.kategorie]) bh.materialien[m.kategorie] = [];
        const list = bh.materialien[m.kategorie];
        if (list.some((x) => x.name.toLowerCase() === m.name.toLowerCase())) continue;
        if (m.standard) list.forEach((x) => delete x.standard);
        const entry = { name: m.name };
        if (m.standard) entry.standard = true;
        list.push(entry);
        changes.push(`Material: ${m.kategorie}/${m.name}${m.standard ? " (Standard)" : ""}`);
      }

      for (const b of behandlungen) {
        if (!b.key || bh.behandlungen[b.key]) continue;
        bh.behandlungen[b.key] = {
          bezeichnung: b.bezeichnung || b.key,
          erkennung: b.erkennung || { goz: [], bema: [], kuerzel: [] },
          material_slots: b.material_slots || [],
          farbe_abfragen: !!b.farbe_abfragen,
          vorlage: b.vorlage || "{{datum}}\n\n{{platzhalter}}\n{{behandler}}",
        };
        changes.push(`Behandlung: ${b.key}`);
      }

      if (changes.length > 0) {
        const neu = JSON.stringify(bh, null, 2) + "\n";
        if (neu !== bhFile.content) {
          await putFile(OWNER, REPO, "behandlungen.json", BRANCH, TOKEN, bhFile.sha, neu,
            `chore(catalog): +${changes.length} Eintrag(e) aus Web-UI`);
        }
      }
    }

    // --- kuerzel.json ---
    if (kuerzel.length > 0) {
      const kzFile = await getFile(OWNER, REPO, "kuerzel.json", BRANCH, TOKEN);
      const kz = JSON.parse(kzFile.content);
      let dirty = false;
      for (const k of kuerzel) {
        const typ = k.typ === "flaechen" ? "flaechen" : "abkuerzungen";
        if (!k.key || !k.value) continue;
        if (!kz[typ]) kz[typ] = {};
        if (kz[typ][k.key]) continue;
        kz[typ][k.key] = k.value;
        changes.push(`Kuerzel: ${typ}/${k.key} -> ${k.value}`);
        dirty = true;
      }
      if (dirty) {
        const neu = JSON.stringify(kz, null, 2) + "\n";
        await putFile(OWNER, REPO, "kuerzel.json", BRANCH, TOKEN, kzFile.sha, neu,
          `chore(catalog): +${kuerzel.length} Kuerzel aus Web-UI`);
      }
    }

    if (changes.length === 0) {
      return res.status(200).json({ ok: true, note: "Nichts geaendert (alles schon vorhanden)." });
    }

    res.status(200).json({
      ok: true,
      changes,
      hinweis: "Commit(s) auf GitHub geschrieben. Vercel deployt gerade neu - in 30-60s im Katalog verfuegbar.",
    });
  } catch (e) {
    res.status(500).json({ error: "Speichern fehlgeschlagen", detail: String(e).slice(0, 500) });
  }
}
