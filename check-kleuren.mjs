// Controleert of buurlanden (gedeelde grenspunten in de diep-packs) dezelfde paletkleur krijgen,
// en stelt een minimale KLEUR_FIX voor (greedy hertoewijzing).
import { readFileSync } from "node:fs";

const PROJ = ".";
const PALET = ["#F59E33", "#EC6B37", "#F5BC2C", "#A1C644", "#3AAA5C", "#12AFAC", "#2D8393", "#4E8FD0"];
// spiegel van GROTE_LANDEN in index.html (handmatig in sync houden)
const GROTE = { RU:"#C9BC8F", CA:"#A9B79B", US:"#9FB6C9", CN:"#C29E74", BR:"#9CBA8D", AU:"#C79E79", IN:"#B4B384", AR:"#B9AE9A", KZ:"#9FB0A4", DZ:"#C4A98C", SA:"#BFB098" };

// 1) LANDEN-volgorde uit index.html (bepaalt de kleurtoewijzing)
const html = readFileSync(PROJ + "/index.html", "utf8");
const blok = html.slice(html.indexOf("const LANDEN=["), html.indexOf("const KLEURPALET"));
const ids = [...blok.matchAll(/\{id:"([A-Z]{2})"/g)].map(m => m[1]);
console.log("LANDEN:", ids.length);

// reuzen: vaste gedempte hexkleur; overige landen: pasteltint (hue) via de gulden snede
const kleurVan = {};
ids.forEach((id, i) => { kleurVan[id] = GROTE[id] !== undefined ? GROTE[id] : Math.round((i * 137.508 + 14) % 360); });
const hueAfstand = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const MIN_AFSTAND = 25; // graden hue-verschil dat buurlanden minimaal moeten hebben

// 2) buurschap via gedeelde grenspunten in álle diep-packs
const punt2landen = new Map();
for (const naam of ["europa", "azie", "afrika", "noord-amerika", "zuid-amerika", "oceanie"]) {
  const pack = JSON.parse(readFileSync(`${PROJ}/data/diep/${naam}.json`, "utf8"));
  for (const id in pack) {
    for (const ring of pack[id]) for (const p of ring) {
      const k = p[0] + "," + p[1];
      let s = punt2landen.get(k); if (!s) punt2landen.set(k, s = new Set());
      s.add(id);
    }
  }
}
const buren = new Map(); // id -> Map(buur -> gedeelde punten)
for (const s of punt2landen.values()) {
  if (s.size < 2) continue;
  const arr = [...s];
  for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
    for (const [x, y] of [[arr[a], arr[b]], [arr[b], arr[a]]]) {
      let m = buren.get(x); if (!m) buren.set(x, m = new Map());
      m.set(y, (m.get(y) || 0) + 1);
    }
  }
}
const buurLijst = id => [...(buren.get(id) || new Map()).entries()].filter(([, n]) => n >= 3).map(([b]) => b);

// 3) botsingen + greedy fix (in LANDEN-volgorde; alleen echte landsgrenzen ≥3 gedeelde punten)
const fix = {};
const kleurNu = id => fix[id] !== undefined ? fix[id] : kleurVan[id];
const lijkt = (a, b) => typeof a === "number" && typeof b === "number" && hueAfstand(a, b) < MIN_AFSTAND;
let botsingen = 0;
for (const id of ids) {
  if (GROTE[id] !== undefined) continue; // reuzen liggen vast
  const bots = buurLijst(id).filter(b => lijkt(kleurNu(b), kleurNu(id)));
  if (!bots.length) continue;
  botsingen++;
  const buurHues = buurLijst(id).map(b => kleurNu(b)).filter(v => typeof v === "number");
  let nieuw = kleurVan[id];
  for (let k = 1; k < 12; k++) { // schuif in gulden-snede-stappen tot alle buren ver genoeg weg zijn
    const kandidaat = Math.round((kleurVan[id] + k * 137.508) % 360);
    if (buurHues.every(h => hueAfstand(h, kandidaat) >= MIN_AFSTAND)) { nieuw = kandidaat; break; }
  }
  fix[id] = nieuw;
  console.log(`${id} (hue ${kleurVan[id]}) lijkt op ${bots.join(",")} → nieuwe hue ${nieuw}`);
}
console.log(`\n${botsingen} botsingen, ${Object.keys(fix).length} fixes:`);
console.log("const KLEUR_FIX={" + Object.entries(fix).map(([id, h]) => `${id}:"hsl(${h} 62% 60%)"`).join(",") + "};");

// 4) eindcontrole: blijven er na de fixes nog botsingen over?
let rest = 0;
for (const id of ids) {
  const bots = buurLijst(id).filter(b => b !== id && lijkt(kleurNu(b), kleurNu(id)));
  if (bots.length) { rest++; console.log(`REST: ${id} ↔ ${bots.join(",")}`); }
}
console.log(rest ? `${rest} resterende botsingen!` : "eindcontrole: botsingsvrij ✓");
