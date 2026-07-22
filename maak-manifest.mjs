// Genereert data/manifest.json: een hash + grootte per datapack.
// Draai dit na elke wijziging aan een pack (build-kaart, build-globe, bouw-inhoud).
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const DATA = "data";
const packs = {};
function loop(dir) {
  for (const naam of readdirSync(dir).sort()) {
    const pad = join(dir, naam);
    if (statSync(pad).isDirectory()) { loop(pad); continue; }
    if (!naam.endsWith(".json") || naam === "manifest.json" || naam === "licenses.json") continue;
    const buf = readFileSync(pad);
    const rel = pad.slice(DATA.length + 1).replaceAll("\\", "/");
    // diep- en gebiedenpacks zijn groot/optioneel: niet precachen, wel bewaren zodra opgehaald
    // (gebieden/index.json is de kleine landenlijst voor de keuzetegel: die wél precachen)
    const lazy = rel.startsWith("diep/") || (rel.startsWith("gebieden/") && !rel.endsWith("index.json"));
    packs[rel] = { hash: createHash("sha256").update(buf).digest("hex").slice(0, 12), bytes: buf.length, ...(lazy ? { lazy: true } : {}) };
  }
}
loop(DATA);
writeFileSync(join(DATA, "manifest.json"), JSON.stringify({ formaat: 1, packs }, null, 1));
console.log(`manifest: ${Object.keys(packs).length} packs, totaal ${Object.values(packs).reduce((a, p) => a + p.bytes, 0)} bytes`);
