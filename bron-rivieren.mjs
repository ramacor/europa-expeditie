// Laadt de NE-rivieren (hoofdset + regionale aanvullingen) op volle resolutie én snapt
// rivierpunten die vlak bij een landsgrens liggen exact op de grenspunten uit de diep-packs.
// Grensrivieren (de Maas langs West-Limburg, de Oder, de Donau-grens) vallen zo precies
// samen met de getekende grens. Gebruikt door build-globe.mjs en build-kaart.mjs.
import { readFileSync } from "node:fs";

const r4 = n => Math.round(n * 10000) / 10000;

function dpLijn(pts, tol) { // Douglas-Peucker voor open lijnen
  if (pts.length <= 2) return pts;
  const t2 = tol * tol, keep = new Set([0, pts.length - 1]);
  const dp = (i, j) => {
    let mx = -1, mi = -1;
    const ax = pts[i][0], ay = pts[i][1], bx = pts[j][0], by = pts[j][1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-12;
    for (let k = i + 1; k < j; k++) {
      const t = Math.max(0, Math.min(1, ((pts[k][0] - ax) * dx + (pts[k][1] - ay) * dy) / len2));
      const px = ax + t * dx - pts[k][0], py = ay + t * dy - pts[k][1], d2 = px * px + py * py;
      if (d2 > mx) { mx = d2; mi = k; }
    }
    if (mx > t2) { keep.add(mi); dp(i, mi); dp(mi, j); }
  };
  dp(0, pts.length - 1);
  return [...keep].sort((a, b) => a - b).map(k => pts[k]);
}

export function laadRivieren() {
  // 1) landgrenspunten: coördinaten die in ≥2 landen voorkomen (kustlijn telt dus niet mee)
  const puntLanden = new Map();
  for (const naam of ["europa", "azie", "afrika", "noord-amerika", "zuid-amerika", "oceanie"]) {
    let pack; try { pack = JSON.parse(readFileSync(`data/diep/${naam}.json`, "utf8")); } catch (e) { continue; }
    for (const id in pack) for (const ring of pack[id]) for (const p of ring) {
      const k = p[0] + "," + p[1];
      const v = puntLanden.get(k);
      if (v === undefined) puntLanden.set(k, id);
      else if (v !== true && v !== id) puntLanden.set(k, true); // true = echt grenspunt
    }
  }
  const CEL = 0.01, grid = new Map();
  for (const [k, v] of puntLanden) {
    if (v !== true) continue;
    const [x, y] = k.split(",").map(Number);
    const ck = Math.round(x / CEL) + ":" + Math.round(y / CEL);
    let lijst = grid.get(ck); if (!lijst) grid.set(ck, lijst = []);
    lijst.push([x, y]);
  }
  puntLanden.clear();
  const SNAP = 0.014; // ~1,5 km: dichterbij dan dit = de rivier ís de grens
  const snap = (x, y) => {
    let best = null, bd = SNAP * SNAP;
    const cx = Math.round(x / CEL), cy = Math.round(y / CEL);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const lijst = grid.get((cx + dx) + ":" + (cy + dy));
      if (!lijst) continue;
      for (const p of lijst) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = p; } }
    }
    return best;
  };
  // 2) rivieren op volle resolutie, gesnapt en licht ontdubbeld
  const rivieren = []; // [scalerank, [[lon,lat],…]]
  let gesnapt = 0, totaal = 0;
  for (const bestand of ["rivieren.geojson", "rivieren-europa.geojson", "rivieren-noord-amerika.geojson"]) {
    let RJ; try { RJ = JSON.parse(readFileSync(bestand, "utf8")); } catch (e) { console.error(bestand + " ontbreekt — overgeslagen"); continue; }
    for (const f of RJ.features) {
      if (!f.geometry) continue;
      const rank = f.properties.scalerank ?? 9;
      const lijnen = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const lijn of lijnen) {
        if (!lijn || lijn.length < 2) continue;
        const uit = [];
        for (const [x, y] of lijn) {
          totaal++;
          const s = snap(x, y);
          const p = s ? (gesnapt++, [s[0], s[1]]) : [r4(x), r4(y)];
          const vorig = uit[uit.length - 1];
          if (!vorig || vorig[0] !== p[0] || vorig[1] !== p[1]) uit.push(p);
        }
        const s2 = dpLijn(uit, 0.0005); // ~55 m: behoudt de volle NE-resolutie, haalt alleen ruis weg
        if (s2.length >= 2) rivieren.push([rank, s2]);
      }
    }
  }
  console.error(`rivieren: ${rivieren.length} lijnen, ${rivieren.reduce((a, l) => a + l[1].length, 0)} punten (${gesnapt} van ${totaal} punten aan een grens gesnapt)`);
  return rivieren;
}
