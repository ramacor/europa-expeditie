// Diep detailniveau voor de globe (fase 4): álle landen op kadaster-achtig detail.
// Bron: geoBoundaries CGAZ ADM0 (cgaz_adm0.geojson, CC BY 4.0) — wereldwijd geharmoniseerd,
// grenzen sluiten op elkaar aan. Eén topojson-topologie → gedeelde grenzen worden één boog
// en simplificeren identiek → buurlanden blijven exact aansluiten (geen ondervulling meer nodig).
// Uitvoer: data/diep/<cont>.json (per continent, lazy geladen) + data/diep/index.json (ring-bboxen voor de lader).
//
// Gebruik:  node --max-old-space-size=18000 build-diep.mjs --analyse     → puntentelling per drempel
//           node --max-old-space-size=18000 build-diep.mjs --w=1e-7     → packs schrijven
import { createReadStream, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { topology } from "topojson-server";
import { presimplify, simplify as vwSimplify } from "topojson-simplify";
import { feature } from "topojson-client";
import { WERELD } from "./bron-wereld.mjs";

const SRC = "cgaz_adm0.geojson";
const ANALYSE = process.argv.includes("--analyse");
const W_ARG = process.argv.find(a => a.startsWith("--w="));
const W_DIEP = W_ARG ? Number(W_ARG.slice(4)) : 1e-7;

// zelfde speelbare-landenlijsten als build-globe.mjs (in sync houden!)
const EU = ["IS","IE","GB","PT","ES","FR","NL","BE","LU","DE","DK","NO","SE","FI","PL","CZ","AT","CH","IT","GR","HU","HR","SI","SK","EE","LV","LT","BA","RS","ME","XK","AL","MK","BG","RO","MD","UA","BY","RU","TR","CY","MT","AD","MC","LI","SM","VA"];
const AS = ["CN","JP","IN","ID","TH","VN","KR","SA","PK","PH","MY","IR","IQ","AF","MN","NP","BD","LK","KP","TW","MM","KH","LA","BT","KZ","UZ","TM","KG","TJ","IL","JO","LB","SY","YE","OM","AE","QA","KW","GE","AM","AZ","TL","SG","BH","MV","BN"];
const CONT = {}; EU.forEach(c => CONT[c] = "EU"); AS.forEach(c => CONT[c] = "AS"); WERELD.forEach(l => CONT[l.id] = l.cont);

// iso3 → iso2: WERELD levert 105 landen, de EU/AS-lijsten mappen we hier met de hand
const ISO3 = Object.fromEntries(WERELD.map(l => [l.iso3, l.id]));
Object.assign(ISO3, {
  ISL:"IS", IRL:"IE", GBR:"GB", PRT:"PT", ESP:"ES", FRA:"FR", NLD:"NL", BEL:"BE", LUX:"LU", DEU:"DE", DNK:"DK",
  NOR:"NO", SWE:"SE", FIN:"FI", POL:"PL", CZE:"CZ", AUT:"AT", CHE:"CH", ITA:"IT", GRC:"GR", HUN:"HU", HRV:"HR",
  SVN:"SI", SVK:"SK", EST:"EE", LVA:"LV", LTU:"LT", BIH:"BA", SRB:"RS", MNE:"ME", XKX:"XK", ALB:"AL", MKD:"MK",
  BGR:"BG", ROU:"RO", MDA:"MD", UKR:"UA", BLR:"BY", RUS:"RU", TUR:"TR", CYP:"CY", MLT:"MT", AND:"AD", MCO:"MC",
  LIE:"LI", SMR:"SM", VAT:"VA",
  CHN:"CN", JPN:"JP", IND:"IN", IDN:"ID", THA:"TH", VNM:"VN", KOR:"KR", SAU:"SA", PAK:"PK", PHL:"PH", MYS:"MY",
  IRN:"IR", IRQ:"IQ", AFG:"AF", MNG:"MN", NPL:"NP", BGD:"BD", LKA:"LK", PRK:"KP", TWN:"TW", MMR:"MM", KHM:"KH",
  LAO:"LA", BTN:"BT", KAZ:"KZ", UZB:"UZ", TKM:"TM", KGZ:"KG", TJK:"TJ", ISR:"IL", JOR:"JO", LBN:"LB", SYR:"SY",
  YEM:"YE", OMN:"OM", ARE:"AE", QAT:"QA", KWT:"KW", GEO:"GE", ARM:"AM", AZE:"AZ", TLS:"TL", SGP:"SG", BHR:"BH",
  MDV:"MV", BRN:"BN",
});
const PLAY = new Set(Object.values(ISO3).filter(id => CONT[id]));

// betwiste gebieden (genummerde CGAZ-features) → feitelijke beheerder, zoals Natural Earth ook doet.
// Anders vallen er donkere gaten in de buurlanden op diep zoomniveau.
// Niet-speelbare gebieden (Falkland 117, Gaza 118, Westelijke Jordaanoever 129 e.d.) blijven bewust weg (grijze rest).
const BETWIST = {
  111: "SS",  // Abyei → Zuid-Soedan
  112: "CN",  // Aksai Chin → China (de facto)
  113: "CN",  // middensector CH-IN → China
  114: "CN",  // Demchok → China
  115: "HR",  // Dragonja-strook → Kroatië
  116: "BT",  // Dramana-Shakatoe → Bhutan
  119: "IN",  // Kalapani → India
  121: "IN",  // Siachen-Saltoro → India
  122: "BF",  // Koualou → Burkina Faso
  126: "SA",  // Sanafir & Tiran → Saoedi-Arabië
};

const r4 = n => Math.round(n * 10000) / 10000;   // 4 decimalen (≈11 m) — zelfde precisie als het NL-kadasterpack
const round4 = ring => ring.map(([lo, la]) => [r4(lo), r4(la)]);
function area(r){ let s = 0; for (let i = 0; i < r.length; i++){ const a = r[i], b = r[(i+1)%r.length]; s += a[0]*b[1] - b[0]*a[1]; } return Math.abs(s/2); }
function bbox(r){ let a=1e9,b=1e9,c=-1e9,d=-1e9; for (const [x,y] of r){ if(x<a)a=x; if(y<b)b=y; if(x>c)c=x; if(y>d)d=y; } return [a,b,c,d]; }

/* ---------- 1) CGAZ streamen en naar spel-codes mappen ---------- */
console.error("CGAZ lezen…");
const perCode = {};                       // iso2 → MultiPolygon-coordinates (mét gaten)
const rl = createInterface({ input: createReadStream(SRC), crlfDelay: Infinity });
let overgeslagen = [];
for await (const regel of rl) {
  if (!regel.startsWith('{ "type": "Feature"')) continue;
  const f = JSON.parse(regel.replace(/,\s*$/, ""));
  const iso3 = f.properties.shapeGroup;
  let code = ISO3[iso3] || BETWIST[iso3];
  if (!code) { overgeslagen.push(iso3); continue; }        // niet-speelbaar gebied (blijft grijze rest op grof niveau)
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let doel = polys;
  if (iso3 === "FRA") {                                    // Frans-Guyana uit Frankrijk knippen (zelfde keuze als fix-geo.mjs)
    const inGuyana = p => { const [x0, y0, x1, y1] = bbox(p[0]); return x0 > -55.6 && x1 < -51 && y0 > 1.5 && y1 < 6.5; };
    const gf = polys.filter(inGuyana);
    doel = polys.filter(p => !inGuyana(p));
    if (gf.length) (perCode.GF ||= []).push(...gf);
  }
  // CGAZ plakt deze gebieden aan het moederland; in het spel zijn het eigen (grijze) gebieden — eruit knippen.
  // Bonaire/Saba/Sint-Eustatius blijven wél bij NL (bijzondere gemeenten); Guadeloupe/Martinique bij FR (departementen).
  const KNIP = {
    NLD: [[-73.5, 9, -73.2, 9.4],        // datasliver bij Colombia (bronfout)
          [-70.2, 12.3, -69.8, 12.75],   // Aruba
          [-69.3, 11.9, -68.6, 12.5],    // Curaçao
          [-63.2, 17.95, -62.95, 18.15]],// Sint-Maarten (zuidkant)
    FRA: [[-63.2, 18.0, -62.9, 18.2],    // Saint-Martin (noordkant)
          [-62.95, 17.85, -62.75, 18.0]],// Saint-Barthélemy
  };
  if (KNIP[iso3]) doel = doel.filter(p => { const b = bbox(p[0]);
    return !KNIP[iso3].some(([x0, y0, x1, y1]) => b[0] >= x0 && b[2] <= x1 && b[1] >= y0 && b[3] <= y1); });
  (perCode[code] ||= []).push(...doel);
}
console.error(`gemapt: ${Object.keys(perCode).length} landen | overgeslagen (niet speelbaar): ${overgeslagen.join(",")}`);

// controle: datumgrens-ringen (zouden door de bron al gesplitst moeten zijn)
for (const code in perCode) for (const poly of perCode[code]) {
  const [x0,, x1] = bbox(poly[0]);
  if (x1 - x0 > 300) console.error(`LET OP: ring over de datumgrens bij ${code} (span ${(x1-x0).toFixed(0)}°)`);
}

/* ---------- 2) één wereldtopologie: gedeelde grenzen = gedeelde bogen ---------- */
console.error("topologie bouwen…");
const feats = Object.entries(perCode).map(([code, polys]) => ({
  type: "Feature", id: code, properties: {},
  geometry: { type: "MultiPolygon", coordinates: polys }
}));
const topo = topology({ landen: { type: "FeatureCollection", features: feats } }, 1e7); // 1e7-raster ≈ 4 m — ruim onder de uitvoerprecisie
console.error(`topologie klaar: ${topo.arcs.length} bogen`);
const pre = presimplify(topo);

/* ---------- 3a) analyse: puntentelling per drempel ---------- */
if (ANALYSE) {
  for (const W of [5e-5, 2e-5, 1e-5, 5e-6, 2e-6, 1e-6]) {
    const simp = vwSimplify(pre, W);
    let tot = 0; const per = {};
    for (const f of feature(simp, simp.objects.landen).features) {
      let n = 0;
      for (const poly of f.geometry.coordinates) for (const r of poly) n += r.length;
      per[f.id] = n; tot += n;
    }
    const top = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([c, n]) => `${c}:${(n/1000).toFixed(0)}k`).join(" ");
    const klein = ["NL","BE","DE","TH","KH","XK"].map(c => `${c}:${((per[c]||0)/1000).toFixed(1)}k`).join(" ");
    console.log(`W=${W}: ${(tot/1e6).toFixed(2)}M punten | zwaarste: ${top} | klein: ${klein}`);
  }
  process.exit(0);
}

/* ---------- 3b) bouwen: simplificeren (per boog), afronden, per continent wegschrijven ----------
   Kust-giganten (Canada, Rusland, …) zouden op de fijne drempel de packs domineren (honderden
   kB's per land). Daarom per boog: bogen die alléén bij een gigant horen (= hun kustlijn) krijgen
   de sterkere cap-drempel; gedeelde landgrenzen houden altijd de fijne drempel, zodat buurlanden
   als NL-DE en RU-FI op vol detail blijven aansluiten. */
const W_CAP = 2e-5;
const GIGANT = new Set(["CA","RU","US","CL","ID","AU","CN","BR","AR","MX","KZ"]);
const arcW = new Array(pre.arcs.length).fill(Infinity);   // per boog: fijnste (kleinste) drempel van de gebruikers
for (const geom of pre.objects.landen.geometries) {
  const w = GIGANT.has(geom.id) ? W_CAP : W_DIEP;
  for (const poly of geom.arcs) for (const ring of poly) for (const a of ring) {
    const i = a < 0 ? ~a : a;
    if (w < arcW[i]) arcW[i] = w;
  }
}
console.error(`simplificeren: fijn W=${W_DIEP}, kust-cap W=${W_CAP} (${GIGANT.size} giganten)…`);
const simp = {
  ...pre,
  arcs: pre.arcs.map((arc, i) => {
    const w = arcW[i] === Infinity ? W_DIEP : arcW[i];
    const uit = arc.filter((p, j) => j === 0 || j === arc.length - 1 || p[2] >= w);
    return uit.length < 2 ? [arc[0], arc[arc.length - 1]] : uit;
  })
};
const perCont = {};                       // cont → { iso2: [ring, ring, …] } (gaten als losse ringen; render vult evenodd)
const index = [];                         // [x0,y0,x1,y1,cont] per betekenisvolle ring — voor de pack-lader
const MIN_RING = 0.0000004;               // ≈ 0,005 km² — piepkleine restringen na simplificatie overslaan
for (const f of feature(simp, simp.objects.landen).features) {
  const cont = CONT[f.id]; if (!cont) continue;
  const ringen = [];
  for (const poly of f.geometry.coordinates) {
    for (const r of poly) {               // buitenring én gaten (Baarle!) als losse ringen
      if (!r || r.length < 4) continue;
      if (area(r) < MIN_RING) continue;
      const rr = round4(r.slice(0, -1));  // slotpunt weg (render sluit zelf); identieke afronding houdt naden dicht
      if (rr.length >= 3) ringen.push(rr);
    }
  }
  if (!ringen.length) continue;
  (perCont[cont] ||= {})[f.id] = ringen;
  for (const r of ringen) {
    const [x0, y0, x1, y1] = bbox(r);
    if (x1 - x0 > 0.02 || y1 - y0 > 0.02)  // alleen ringen die groot genoeg zijn om op te zoomen
      index.push([Math.round(x0*100)/100, Math.round(y0*100)/100, Math.round(x1*100)/100, Math.round(y1*100)/100, cont]);
  }
}

mkdirSync("data/diep", { recursive: true });
const NAAM = { EU: "europa", AS: "azie", AF: "afrika", NA: "noord-amerika", SA: "zuid-amerika", OC: "oceanie" };
let totaal = 0;
for (const cont in perCont) {
  const json = JSON.stringify(perCont[cont]);
  writeFileSync(`data/diep/${NAAM[cont]}.json`, json);
  const punten = Object.values(perCont[cont]).flat().reduce((a, r) => a + r.length, 0);
  totaal += punten;
  console.log(`data/diep/${NAAM[cont]}.json: ${Object.keys(perCont[cont]).length} landen, ${(punten/1000).toFixed(0)}k punten, ${(json.length/1048576).toFixed(1)} MB`);
}
writeFileSync("data/diep/index.json", JSON.stringify(index));
console.log(`data/diep/index.json: ${index.length} ring-bboxen, ${(JSON.stringify(index).length/1024).toFixed(0)} KB`);
console.log(`totaal: ${(totaal/1e6).toFixed(2)}M punten — vergeet 'node maak-manifest.mjs' niet`);
