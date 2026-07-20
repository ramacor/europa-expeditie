// Bepaalt welke meren "intern" zijn (raken nergens de zee) — die krijgen in het spel een
// lichtere waterkleur dan de zee. Werkwijze: de kustlijn bestaat uit ringsegmenten die maar
// in één land voorkomen (landgrenzen worden door twee buurlanden gedeeld). Een meer raakt de
// zee als een oeverpunt vlak bij zo'n kustsegment ligt (lagunes: Maracaibo, IJsselmeer, …).
// Gebruikt door build-globe.mjs en build-kaart.mjs.
export function bepaalInterneMeren(gj, MEREN) {
  // 1) segmenten tellen over alle buitenringen: 1× = kust, 2× = binnenlandse grens
  const segTel = new Map();
  const segKey = (a, b) => { const s1 = a[0] + "," + a[1], s2 = b[0] + "," + b[1]; return s1 < s2 ? s1 + "|" + s2 : s2 + "|" + s1; };
  for (const f of gj.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const r = poly[0];
      if (!r || r.length < 4) continue;
      for (let i = 0; i < r.length - 1; i++) { const k = segKey(r[i], r[i + 1]); segTel.set(k, (segTel.get(k) || 0) + 1); }
    }
  }
  // 2) kustpunten in een rooster (detectiestraal ≈ 3-6 km)
  const CEL = 0.03, grid = new Set();
  const cel = (x, y) => Math.round(x / CEL) + ":" + Math.round(y / CEL);
  for (const [k, n] of segTel) {
    if (n !== 1) continue;
    for (const p of k.split("|")) { const [x, y] = p.split(",").map(Number); grid.add(cel(x, y)); }
  }
  const bijKust = (x, y) => {
    const cx = Math.round(x / CEL), cy = Math.round(y / CEL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (grid.has((cx + dx) + ":" + (cy + dy))) return true;
    return false;
  };
  // 3) meren classificeren op hun oeverpunten
  const FORCEER_INTERN = new Set(["Lake Malawi"]); // grens loopt hier óver de oever → oogt als kust, is het niet
  const intern = new Set();
  MEREN.features.forEach((f, i) => {
    if (!f.geometry) return;
    const naam = (f.properties && (f.properties.name || f.properties.name_en)) || "";
    if (FORCEER_INTERN.has(naam)) { intern.add(i); return; }
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let raaktZee = false;
    buiten: for (const poly of polys) {
      const ring = poly[0] || [];
      for (let k = 0; k < ring.length; k += 2) {
        if (bijKust(ring[k][0], ring[k][1])) { raaktZee = true; break buiten; }
      }
    }
    if (!raaktZee) intern.add(i);
  });
  return intern;
}
