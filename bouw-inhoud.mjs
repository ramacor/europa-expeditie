// Zoekt foto's op via de Wikipedia batch-API (50 titels per verzoek, dus geen
// rate-limits) en injecteert feitjes/woordjes/foto's in europa-expeditie.html.
import { readFileSync, writeFileSync } from "node:fs";
import bron from "./bron-inhoud.mjs";

const HTML = "index.html";
const UA = { headers: { "User-Agent": "EuropaExpeditie/1.0 (educatief kinderspel; github ramacor)" } };

// haalt voor een lijst titels de paginafoto op: Map<gevraagde titel, {src,url}>
async function batchFotos(wiki, titels) {
  const uit = new Map();
  for (let i = 0; i < titels.length; i += 50) {
    const stuk = titels.slice(i, i + 50);
    const url = `https://${wiki}.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=640&titles=${encodeURIComponent(stuk.join("|"))}`;
    const r = await fetch(url, UA);
    if (!r.ok) { console.log(`batch ${wiki} status ${r.status}`); continue; }
    const j = await r.json();
    const q = j.query || {};
    // gevraagde titel → definitieve titel (na normalisatie en redirects)
    const naar = new Map();
    for (const n of q.normalized || []) naar.set(n.from, n.to);
    for (const rd of q.redirects || []) naar.set(rd.from, rd.to);
    const volg = t => { let x = t, i = 0; while (naar.has(x) && i++ < 5) x = naar.get(x); return x; };
    const perTitel = new Map();
    for (const p of Object.values(q.pages || {})) if (!p.missing) perTitel.set(p.title, p);
    for (const t of stuk) {
      const p = perTitel.get(volg(t));
      const src = p && p.thumbnail && p.thumbnail.source;
      if (src && src.includes("/wikipedia/commons/")) // alleen vrije Commons-foto's
        uit.set(t, { src, url: `https://${wiki}.wikipedia.org/wiki/${encodeURIComponent(p.title.replaceAll(" ", "_"))}` });
    }
    await new Promise(r2 => setTimeout(r2, 300));
  }
  return uit;
}

// verzamel alle titels per wiki
const perWiki = { nl: [], en: [] };
for (const land of Object.values(bron)) for (const [, artikel, wiki] of land.fotos) perWiki[wiki].push(artikel);
const nlFotos = await batchFotos("nl", perWiki.nl);
// nl-missers proberen we ook op de Engelse wiki
const nlMis = perWiki.nl.filter(t => !nlFotos.has(t));
const enFotos = await batchFotos("en", [...perWiki.en, ...nlMis]);

const EXTRA = {}, missers = [];
for (const [code, land] of Object.entries(bron)) {
  const fotos = [];
  for (const [titel, artikel, wiki] of land.fotos) {
    const f = (wiki === "nl" ? nlFotos.get(artikel) : null) || enFotos.get(artikel);
    if (f) fotos.push({ t: titel, src: f.src, url: f.url });
    else missers.push(`${code}: ${artikel} (${wiki})`);
  }
  EXTRA[code] = { feiten: land.feiten, woorden: land.woorden, fotos };
}

if (missers.length) { console.log("NIET GEVONDEN:"); for (const m of missers) console.log("  -", m); }

// bij een API-blokkade (0 foto's): niets wegschrijven, zodat een herhaal-lus het later opnieuw kan proberen
const totaalFotos = Object.values(EXTRA).reduce((s, l) => s + l.fotos.length, 0);
if (totaalFotos === 0) { console.log("Geen enkele foto opgehaald (API-blokkade?) — HTML NIET aangepast."); process.exit(1); }

let html = readFileSync(HTML, "utf8");
const blok = `<script id="inhoud">
// Feitjes, woordjes en foto's per land. Foto's: Wikimedia Commons via Wikipedia (vrije licenties), met bronlink.
const EXTRA=${JSON.stringify(EXTRA)};
</${"script"}>`;
html = html.replace(/<script id="inhoud">[\s\S]*?<\/script>/, blok);
writeFileSync(HTML, html);
const tot = k => Object.values(EXTRA).reduce((s, l) => s + l[k].length, 0);
const dun = Object.entries(EXTRA).filter(([, l]) => l.fotos.length < 3).map(([c, l]) => `${c}:${l.fotos.length}`);
console.log(`Totaal: ${tot("feiten")} feitjes, ${tot("woorden")} woordjes, ${tot("fotos")} foto's. HTML: ${html.length} tekens.`);
console.log("Landen met <3 foto's:", dun.length ? dun.join(", ") : "geen");
