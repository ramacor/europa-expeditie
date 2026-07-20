// Schaduwreliëf (hillshade) voor de globe: bergen krijgen licht op de NW-flank en schaduw op
// de ZO-flank — zoals een atlas reliëf tekent. Uit het hoogtegrid worden vectorpolygonen
// gemaakt voor twee schaduwtinten en één lichttint, plus heel subtiele hoogtebanden.
// Bron: Terrain Tiles (AWS Open Data, "terrarium"; NASA SRTM/USGS GMTED/NOAA ETOPO1 — publiek
// domein). Tegels worden gecachet in hoogte-tiles/ (gitignored).
// Uitvoer: data/core/hoogte.json → {banden:[{h,r}], schaduw:[{v,r}]} (v<0 donker, v>0 licht).
// Gebruik: node --max-old-space-size=8000 build-hoogte.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { PNG } from "pngjs";
import { contours } from "d3-contour";

const Z = 6, N = 2 ** Z, PX = 256, W = N * PX;      // 64×64 tegels van 256px → 16384×16384 (mercator, ~2,4 km/px)
const BANDEN = [600, 1800, 3600];                    // heel subtiele hoogtebanden (meters)
const EXAGGERATIE = 3;                               // verticale overdrijving (op 2,4 km-cellen zijn hellingen al vrij steil)
const MIN_HOOGTE = 250;                              // laagland niet arceren (blijft strak)
const TILES = "hoogte-tiles";
mkdirSync(TILES, { recursive: true });

/* ---------- 1) tegels ophalen (met cache) en samenvoegen ---------- */
async function haalTegel(x, y) {
  const pad = `${TILES}/${Z}-${x}-${y}.png`;
  if (!existsSync(pad)) {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
    if (!r.ok) throw new Error(`tegel ${x},${y}: ${r.status}`);
    writeFileSync(pad, Buffer.from(await r.arrayBuffer()));
  }
  return PNG.sync.read(readFileSync(pad));
}
console.error(`tegels ophalen (${N}×${N})…`);
let grid = new Float32Array(W * W);
const alleTegels = [];
for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) alleTegels.push([tx, ty]);
for (let b = 0; b < alleTegels.length; b += 32) {
  const batch = alleTegels.slice(b, b + 32);
  const pngs = await Promise.all(batch.map(([tx, ty]) => haalTegel(tx, ty)));
  batch.forEach(([tx, ty], k) => {
    const png = pngs[k];
    for (let py = 0; py < PX; py++) for (let px = 0; px < PX; px++) {
      const i = (py * PX + px) * 4;
      grid[(ty * PX + py) * W + (tx * PX + px)] = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
    }
  });
  process.stderr.write(`${Math.min(b + 32, alleTegels.length)}/${alleTegels.length}\r`);
}

/* ---------- 2) licht vervagen (ruis weg → rustige, vloeiende schaduwvormen) ---------- */
console.error("vervagen…");
function blur(src) {
  const uit = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; uit[i] = (src[i - 1] + src[i] + src[i + 1]) / 3; }
  for (let x = 0; x < W; x++) for (let y = 1; y < W - 1; y++) { const i = y * W + x; src[i] = (uit[i - W] + uit[i] + uit[i + W]) / 3; }
  return src;
}
grid = blur(blur(grid));

/* ---------- 3) hillshade: verlichting vanuit het noordwesten ---------- */
console.error("hillshade rekenen…");
const naarLat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / W))) * 180 / Math.PI;
const ZENIT = 45 * Math.PI / 180, AZIMUT = 315 * Math.PI / 180;
const NEUTRAAL = Math.cos(ZENIT); // vlak terrein
const shade = new Float32Array(W * W).fill(NEUTRAAL);
for (let y = 1; y < W - 1; y++) {
  const cel = 40075017 / W * Math.cos(naarLat(y) * Math.PI / 180); // celgrootte in meters (mercator)
  if (cel < 500) continue; // extreem hoge breedtegraden overslaan
  for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (grid[i] < MIN_HOOGTE) continue;
    const dzdx = (grid[i + 1] - grid[i - 1]) / (2 * cel) * EXAGGERATIE;
    const dzdy = (grid[i + W] - grid[i - W]) / (2 * cel) * EXAGGERATIE;
    const slope = Math.atan(Math.hypot(dzdx, dzdy));
    const aspect = Math.atan2(dzdy, -dzdx);
    shade[i] = Math.max(0, Math.cos(ZENIT) * Math.cos(slope) + Math.sin(ZENIT) * Math.sin(slope) * Math.cos(AZIMUT - aspect));
  }
}

/* ---------- 4) contourpolygonen: schaduw (2 tinten), licht (1 tint), hoogtebanden ---------- */
const naarLon = x => x / W * 360 - 180;
function dpLijn(pts, tol) {
  if (pts.length <= 4) return pts;
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
const area = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };
const r2 = n => Math.round(n * 100) / 100;
function vectoriseer(rasterGrid, drempels, minArea, tol) {
  return contours().size([W, W]).thresholds(drempels)(rasterGrid).map(c => {
    const ringen = [];
    for (const poly of c.coordinates) for (const ring of poly) {
      const ll = ring.map(([x, y]) => [naarLon(x), naarLat(y)]);
      const s = dpLijn(ll, tol);
      if (s.length < 4 || area(s) < minArea) continue;
      ringen.push(s.map(([lo, la]) => [r2(lo), r2(la)]));
    }
    return { drempel: c.value, r: ringen };
  });
}
console.error("contouren rekenen…");
// donker: 1-shade ≥ 0.42 (schaduwflank) en ≥ 0.56 (diepe schaduw); licht: shade ≥ 0.85 (zonflank)
const inv = new Float32Array(W * W); for (let i = 0; i < W * W; i++) inv[i] = 1 - shade[i];
const donker = vectoriseer(inv, [0.42, 0.56], 0.025, 0.014);
const licht = vectoriseer(shade, [0.85], 0.025, 0.014);
const schaduw = [
  { v: -0.10, r: donker[0].r },  // schaduwflank
  { v: -0.12, r: donker[1].r },  // diepe schaduw (komt bovenop de eerste)
  { v: 0.13, r: licht[0].r },    // zonflank
];
const banden = vectoriseer(grid, BANDEN, 0.05, 0.02).map(b => ({ h: b.drempel, r: b.r }));
for (const b of banden) console.error(`  band ≥${b.h} m: ${b.r.length} ringen`);
for (const s of schaduw) console.error(`  schaduw ${s.v}: ${s.r.length} ringen, ${s.r.reduce((a, r) => a + r.length, 0)} punten`);

const uit = { banden, schaduw };
writeFileSync("data/core/hoogte.json", JSON.stringify(uit));
console.log(`data/core/hoogte.json: ${Math.round(JSON.stringify(uit).length / 1024)} KB — vergeet 'node maak-manifest.mjs' niet`);
