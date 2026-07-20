// Vlakt alléén zeer scherpe hoekjes een fractie af (binnenhoek < drempel): de kaart oogt
// minder hoekig — grenzen langs rivieren zijn in het echt immers glooiend — terwijl échte
// rechte hoeken (Westelijke Sahara, ±90°) gewoon scherp blijven.
// Werkt per ring en puur lokaal: gedeelde grenzen bij buurlanden ronden identiek af.
export function rondHoeken(ring, drempel = 80, t = 0.25, cap = 0.15) {
  if (!ring || ring.length < 4) return ring;
  const gesloten = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = gesloten ? ring.slice(0, -1) : ring;
  const n = pts.length;
  if (n < 3) return ring;
  const cosD = Math.cos((180 - drempel) * Math.PI / 180); // draaihoek > 180-drempel ⇔ binnenhoek < drempel
  const uit = [];
  for (let i = 0; i < n; i++) {
    const c = pts[i];
    if (!gesloten && (i === 0 || i === n - 1)) { uit.push(c); continue; }
    const p = pts[(i - 1 + n) % n], q = pts[(i + 1) % n];
    const ax = c[0] - p[0], ay = c[1] - p[1], bx = q[0] - c[0], by = q[1] - c[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!la || !lb) { uit.push(c); continue; }
    const cosT = (ax * bx + ay * by) / (la * lb);
    if (cosT > cosD) { uit.push(c); continue; }        // geen scherpe hoek: laten staan
    const ta = Math.min(t, cap / la), tb = Math.min(t, cap / lb); // cap: bij lange rechte benen maar een klein stukje afsnijden
    uit.push([c[0] - ax * ta, c[1] - ay * ta], [c[0] + bx * tb, c[1] + by * tb]);
  }
  if (gesloten) uit.push([uit[0][0], uit[0][1]]);
  return uit;
}
