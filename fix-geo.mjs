// fix-geo.mjs — geopolitieke correcties op de Natural Earth-brondata, gedeeld door
// build-kaart.mjs en build-globe.mjs (één waarheid, beide kaartsoorten identiek):
//
// 1) Westelijke Sahara als één gebied. Natural Earth tekent de-facto: het Marokko-
//    veelvlak loopt door tot de zandberm en "W. Sahara" is alleen de oostelijke
//    reststrook. Wij snijden Marokko op de noordgrens van het gebied (27°40'NB,
//    exact overgenomen uit de EH-strook) en voegen zuiddeel + strook samen tot één
//    EH-gebied met een normale landgrens.
// 2) Frans-Guyana (GF) als eigen gebied, losgeknipt uit het Frankrijk-veelvlak.
import pc from "polygon-clipping";

const code = p => p.ISO_A2 && p.ISO_A2 !== "-99" ? p.ISO_A2 : (p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : null);
const alsMulti = g => g.type === "Polygon" ? [g.coordinates] : g.coordinates;

export function fixGeo(gj){
  const feats = gj.features;
  const vind = c => feats.find(f => code(f.properties) === c);

  // — Westelijke Sahara: Marokko splitsen op 27°40'NB en samenvoegen met de oostsrook —
  const ma = vind("MA"), eh = vind("EH");
  if (ma && eh) {
    let cut = -99; // exacte breedtegraad van de noordrand van de EH-strook
    for (const ring of alsMulti(eh.geometry).flat(1)) for (const p of ring) if (p[1] > cut) cut = p[1];
    const rect = [[[[-20, cut], [-6, cut], [-6, 20], [-20, 20], [-20, cut]]]];
    const maMulti = alsMulti(ma.geometry);
    const zuid  = pc.intersection(maMulti, rect);
    const noord = pc.difference(maMulti, rect);
    const heel  = pc.union(zuid, alsMulti(eh.geometry));
    ma.geometry = { type: "MultiPolygon", coordinates: noord };
    eh.geometry = { type: "MultiPolygon", coordinates: heel };
  }

  // — Frans-Guyana: Zuid-Amerikaanse polygonen uit Frankrijk → eigen GF-feature —
  const fr = vind("FR");
  if (fr && !vind("GF")) {
    const alle = alsMulti(fr.geometry);
    const inSA = poly => { const [lo, la] = poly[0][0]; return lo > -60 && lo < -45 && la > 1 && la < 7; };
    const gf = alle.filter(inSA);
    if (gf.length) {
      fr.geometry = { type: "MultiPolygon", coordinates: alle.filter(p => !inSA(p)) };
      feats.push({ type: "Feature",
        properties: { ADMIN: "French Guiana", NAME: "French Guiana", ISO_A2: "GF", ISO_A2_EH: "GF", TYPE: "Dependency" },
        geometry: { type: "MultiPolygon", coordinates: gf } });
    }
  }
  return gj;
}
