// Gebiedenronde-pijplijn: bouwt per land een kaartpack met de provincies/staten/deelstaten.
// Bron: Natural Earth 10m admin-1 (ne10m_admin1.geojson, publiek domein) — zelfde bron-familie
// als de landkaarten. Eén topojson-topologie per land → gedeelde binnengrenzen worden één boog
// en simplificeren identiek → buurgebieden sluiten naadloos aan (zelfde truc als build-diep.mjs).
// Uitvoer: data/gebieden/<key>.json (lazy geladen zodra het land gekozen wordt)
//          + data/gebieden/index.json (landenlijst voor de keuzetegel).
//
// Gebruik:  node build-gebieden.mjs            → alle landen
//           node build-gebieden.mjs nl fr us   → alleen deze packs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { topology } from "topojson-server";
import { presimplify, simplify as vwSimplify } from "topojson-simplify";
import { feature, mergeArcs } from "topojson-client";

/* ---------- Nederlandse namen voor samengevoegde regio's ---------- */
const NL_FR = { "Hauts-de-France":"Hauts-de-France", "Grand Est":"Grand Est", "Provence-Alpes-Côte-d'Azur":"Provence-Alpes-Côte d'Azur",
  "Auvergne-Rhône-Alpes":"Auvergne-Rhône-Alpes", "Nouvelle-Aquitaine":"Nouvelle-Aquitaine", "Occitanie":"Occitanië",
  "Bourgogne-Franche-Comté":"Bourgogne-Franche-Comté", "Pays de la Loire":"Pays de la Loire", "Bretagne":"Bretagne",
  "Normandie":"Normandië", "Corse":"Corsica", "Centre-Val de Loire":"Centre-Val de Loire", "Île-de-France":"Île-de-France" };
const NL_ES = { "Andalucía":"Andalusië", "Aragón":"Aragón", "Asturias":"Asturië", "Cantabria":"Cantabrië",
  "Castilla y León":"Castilië en León", "Castilla-La Mancha":"Castilië-La Mancha", "Cataluña":"Catalonië",
  "Madrid":"Madrid", "Valenciana":"Valencia", "Extremadura":"Extremadura", "Galicia":"Galicië",
  "Islas Baleares":"Balearen", "Canary Is.":"Canarische Eilanden", "La Rioja":"La Rioja", "País Vasco":"Baskenland",
  "Murcia":"Murcia", "Foral de Navarra":"Navarra", "Ceuta":"Ceuta", "Melilla":"Melilla" };
const NL_IT = { "Valle d'Aosta":"Valle d'Aosta", "Piemonte":"Piëmont", "Lombardia":"Lombardije",
  "Trentino-Alto Adige":"Trentino-Zuid-Tirol", "Liguria":"Ligurië", "Emilia-Romagna":"Emilia-Romagna", "Marche":"Marche",
  "Veneto":"Veneto", "Friuli-Venezia Giulia":"Friuli-Venezia Giulia", "Abruzzo":"Abruzzen", "Molise":"Molise",
  "Apulia":"Apulië", "Basilicata":"Basilicata", "Calabria":"Calabrië", "Campania":"Campanië", "Lazio":"Lazio",
  "Toscana":"Toscane", "Sicily":"Sicilië", "Sardegna":"Sardinië", "Umbria":"Umbrië" };
const NL_GB = { "England":"Engeland", "Scotland":"Schotland", "Wales":"Wales", "Northern Ireland":"Noord-Ierland" };

/* ---------- landconfiguratie ----------
   filter(p): welke admin-1-features meedoen; groep(p): samenvoeg-sleutel (regio's/landsdelen);
   groepNaam: NL-naam per groep; soort/lidw sturen de vraagteksten in het spel. */
const AU_WEG = new Set(["Jervis Bay Territory", "Macquarie Island", "Lord Howe Island", "Ashmore and Cartier Islands"]);
const LANDEN = {
  nl: { iso:"NL", naam:"Nederland",           f:"🇳🇱", soort:"provincie",  lidw:"de", soortMv:"provincies",
        filter:p=>p.type_en==="Province" },
  be: { iso:"BE", naam:"België",              f:"🇧🇪", soort:"provincie",  lidw:"de", soortMv:"provincies",
        naamFix:{ "Brussels Hoofdstedelijk Gewest":"Brussel" },
        soortItem:p=>p.type_en==="Province"?undefined:{so:""} }, // Brussel is geen provincie → vraag zonder soort
  de: { iso:"DE", naam:"Duitsland",           f:"🇩🇪", soort:"deelstaat",  lidw:"de", soortMv:"deelstaten" },
  fr: { iso:"FR", naam:"Frankrijk",           f:"🇫🇷", soort:"regio",      lidw:"de", soortMv:"regio's",
        filter:p=>p.type_en==="Metropolitan department", groep:p=>p.region, groepNaam:NL_FR },
  frdep: { iso:"FR", naam:"Frankrijk",        f:"🇫🇷", soort:"departement",lidw:"het", soortMv:"departementen",
        filter:p=>p.type_en==="Metropolitan department" },
  es: { iso:"ES", naam:"Spanje",              f:"🇪🇸", soort:"regio",      lidw:"de", soortMv:"regio's",
        groep:p=>p.region||p.name, groepNaam:NL_ES,
        itemFix:{ "Ceuta":{so:""}, "Melilla":{so:""} } }, // autonome steden, geen regio's
  it: { iso:"IT", naam:"Italië",              f:"🇮🇹", soort:"regio",      lidw:"de", soortMv:"regio's",
        groep:p=>p.region, groepNaam:NL_IT },
  gb: { iso:"GB", naam:"Verenigd Koninkrijk", f:"🇬🇧", soort:"landsdeel",  lidw:"het", soortMv:"landsdelen",
        groep:p=>p.geonunit, groepNaam:NL_GB },
  ch: { iso:"CH", naam:"Zwitserland",         f:"🇨🇭", soort:"kanton",     lidw:"het", soortMv:"kantons" },
  at: { iso:"AT", naam:"Oostenrijk",          f:"🇦🇹", soort:"deelstaat",  lidw:"de", soortMv:"deelstaten" },
  pl: { iso:"PL", naam:"Polen",               f:"🇵🇱", soort:"woiwodschap",lidw:"de", soortMv:"woiwodschappen" },
  cz: { iso:"CZ", naam:"Tsjechië",            f:"🇨🇿", soort:"regio",      lidw:"de", soortMv:"regio's" },
  dk: { iso:"DK", naam:"Denemarken",          f:"🇩🇰", soort:"regio",      lidw:"de", soortMv:"regio's" },
  se: { iso:"SE", naam:"Zweden",              f:"🇸🇪", soort:"provincie",  lidw:"de", soortMv:"provincies (län)" },
  gr: { iso:"GR", naam:"Griekenland",         f:"🇬🇷", soort:"regio",      lidw:"de", soortMv:"regio's",
        filter:p=>p.name_nl!=="Oros Athos" },
  ua: { iso:"UA", naam:"Oekraïne",            f:"🇺🇦", soort:"oblast",     lidw:"de", soortMv:"oblasten",
        filter:p=>p.type_en!=="Municipality", // Kiev-stad weg (naast de oblast met dezelfde naam)
        extra:p=>p.iso_a2==="RU"&&p.iso_3166_2==="UA-43", // de Krim staat in NE onder Rusland maar hoort bij Oekraïne (zelfde keuze als CGAZ/VN)
        naamFix:{ "Crimea":"De Krim", "Autonome Republiek van de Krim":"De Krim" },
        itemFix:{ "De Krim":{so:""} } }, // autonome republiek, geen oblast
  us: { iso:"US", naam:"Verenigde Staten",    f:"🇺🇸", soort:"staat",      lidw:"de", soortMv:"staten",
        filter:p=>p.type_en==="State", // Washington D.C. is geen staat (en te klein om aan te wijzen)
        lam0:-105, phi1:45, budget:12000 },
  ca: { iso:"CA", naam:"Canada",              f:"🇨🇦", soort:"provincie",  lidw:"de", soortMv:"provincies & territoria",
        soortItem:p=>p.type_en==="Territory"?{so:"territorium",li:"het"}:undefined,
        lam0:-95, phi1:62, budget:12000 },
  au: { iso:"AU", naam:"Australië",           f:"🇦🇺", soort:"staat",      lidw:"de", soortMv:"staten & territoria",
        filter:p=>!AU_WEG.has(p.name),
        soortItem:p=>p.type_en==="Territory"?{so:"territorium",li:"het"}:undefined },
  br: { iso:"BR", naam:"Brazilië",            f:"🇧🇷", soort:"staat",      lidw:"de", soortMv:"staten" },
  jp: { iso:"JP", naam:"Japan",               f:"🇯🇵", soort:"prefectuur", lidw:"de", soortMv:"prefecturen", budget:11000 },
  mx: { iso:"MX", naam:"Mexico",              f:"🇲🇽", soort:"staat",      lidw:"de", soortMv:"staten",
        filter:p=>!!p.name,
        soortItem:p=>p.type_en==="State"?undefined:{so:""} }, // Mexico-Stad is geen staat
  za: { iso:"ZA", naam:"Zuid-Afrika",         f:"🇿🇦", soort:"provincie",  lidw:"de", soortMv:"provincies" },
  cn: { iso:"CN", naam:"China",               f:"🇨🇳", soort:"provincie",  lidw:"de", soortMv:"provincies",
        filter:p=>p.geonunit!=="Paracel Islands",
        soortItem:p=>p.type_en==="Province"?undefined:{so:""} }, // autonome regio's en stadsprovincies (Tibet, Beijing…)
  in: { iso:"IN", naam:"India",               f:"🇮🇳", soort:"staat",      lidw:"de", soortMv:"staten & territoria",
        soortItem:p=>p.type_en==="State"?undefined:{so:""} }, // unieterritoria (Delhi…)
  ar: { iso:"AR", naam:"Argentinië",          f:"🇦🇷", soort:"provincie",  lidw:"de", soortMv:"provincies",
        itemFix:{ "Ciudad de Buenos Aires":{so:""} } },
};
const VOLGORDE = ["nl","be","de","fr","frdep","es","it","gb","ch","at","pl","cz","dk","se","gr","ua",
                  "us","ca","au","br","jp","mx","za","cn","in","ar"]; // volgorde in de keuzelijst (Europa eerst)

const VB = { w:1050, h:920, marge:8 };
const D = Math.PI/180;
const r1 = n => Math.round(n*10)/10;
const BUDGET_STD = 9000; // maximaal aantal unieke grenspunten per pack (kust-giganten iets meer via cfg.budget)

/* ---------- gereedschap (zelfde als build-land.mjs) ---------- */
function area(r){ let s=0; for(let i=0;i<r.length;i++){ const a=r[i], b=r[(i+1)%r.length]; s+=a[0]*b[1]-b[0]*a[1]; } return Math.abs(s/2); }
function signedArea(r){ let s=0; for(let i=0;i<r.length;i++){ const a=r[i], b=r[(i+1)%r.length]; s+=a[0]*b[1]-b[0]*a[1]; } return s/2; }
function centroid(ring){
  let s=0,cx=0,cy=0;
  for(let i=0;i<ring.length;i++){ const a=ring[i], b=ring[(i+1)%ring.length], k=a[0]*b[1]-b[0]*a[1]; s+=k; cx+=(a[0]+b[0])*k; cy+=(a[1]+b[1])*k; }
  if(Math.abs(s)<1e-9){ const xs=ring.map(p=>p[0]), ys=ring.map(p=>p[1]); return [(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2]; }
  return [cx/(3*s), cy/(3*s)];
}
function bboxVan(rings){ let a=1e9,b=1e9,c=-1e9,d=-1e9;
  for(const r of rings) for(const [x,y] of r){ if(x<a)a=x; if(x>c)c=x; if(y<b)b=y; if(y>d)d=y; } return [a,b,c,d]; }
const lerpX=(a,b,x)=>[x, a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0])];
const lerpY=(a,b,y)=>[a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]), y];
function clipRing(ring, WIN){
  const edges=[[p=>p[0]>=WIN.x0,(a,b)=>lerpX(a,b,WIN.x0)],[p=>p[0]<=WIN.x1,(a,b)=>lerpX(a,b,WIN.x1)],
               [p=>p[1]>=WIN.y0,(a,b)=>lerpY(a,b,WIN.y0)],[p=>p[1]<=WIN.y1,(a,b)=>lerpY(a,b,WIN.y1)]];
  let out=ring;
  for(const [inside,cross] of edges){
    const inp=out; out=[];
    for(let i=0;i<inp.length;i++){
      const a=inp[i], b=inp[(i+1)%inp.length];
      if(inside(a)){ out.push(a); if(!inside(b)) out.push(cross(a,b)); }
      else if(inside(b)) out.push(cross(a,b));
    }
    if(out.length<3) return [];
  }
  return out;
}
function simplifyDP(ring, tol){ // alleen voor context/meren; de gebieden zelf gaan via de topologie
  if(ring.length<=4) return ring;
  const t2=tol*tol;
  const dp=(pts,i,j,keep)=>{
    let mx=-1,mi=-1;
    const ax=pts[i][0],ay=pts[i][1],bx=pts[j][0],by=pts[j][1];
    const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy||1e-12;
    for(let k=i+1;k<j;k++){
      const t=Math.max(0,Math.min(1,((pts[k][0]-ax)*dx+(pts[k][1]-ay)*dy)/len2));
      const px=ax+t*dx-pts[k][0], py=ay+t*dy-pts[k][1], d2=px*px+py*py;
      if(d2>mx){mx=d2;mi=k;}
    }
    if(mx>t2){keep.add(mi);dp(pts,i,mi,keep);dp(pts,mi,j,keep);}
  };
  const keep=new Set([0,ring.length-1]); dp(ring,0,ring.length-1,keep);
  return ring.filter((_,i)=>keep.has(i));
}
const pad=ringen=>ringen.map(r=>"M"+r.map(p=>r1(p[0])+" "+r1(p[1])).join("L")+"Z").join("");
const slug=s=>s.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Za-z0-9]+/g,"").toUpperCase().slice(0,12);

/* ---------- bron lezen ---------- */
console.error("admin-1 lezen…");
const ADMIN1 = JSON.parse(readFileSync("ne10m_admin1.geojson","utf8")).features;
const NE0 = JSON.parse(readFileSync("ne10m.geojson","utf8")).features; // context: omliggende landen
const codeVan = p => p.ISO_A2 && p.ISO_A2!=="-99" ? p.ISO_A2 : (p.ISO_A2_EH && p.ISO_A2_EH!=="-99" ? p.ISO_A2_EH : null);

const doel = process.argv.slice(2).length ? process.argv.slice(2) : VOLGORDE;
mkdirSync("data/gebieden", { recursive:true });
const indexUit = [];
let totaalBytes = 0, totaalPunten = 0;

for (const key of VOLGORDE) {
  const cfg = LANDEN[key];
  if (!doel.includes(key)) continue;

  /* -- 1) features kiezen -- */
  let feats = ADMIN1.filter(f => f.properties.iso_a2===cfg.iso && (!cfg.filter || cfg.filter(f.properties)));
  if (cfg.extra) feats = feats.concat(ADMIN1.filter(f => cfg.extra(f.properties)));

  /* -- 2) eventueel samenvoegen tot regio's/landsdelen -- */
  // eerst één topologie over de losse features (gedeelde grenzen = gedeelde bogen)
  const fc = { type:"FeatureCollection", features: feats.map((f,i)=>({ type:"Feature", id:"f"+i, properties:f.properties, geometry:f.geometry })) };
  const topo = topology({ g: fc }, 1e6);
  let geoms; // [{id, naam, geom(topojson)}]
  if (cfg.groep) {
    const groepen = new Map();
    topo.objects.g.geometries.forEach((g,i)=>{
      const p = feats[i].properties, sleutel = cfg.groep(p);
      if(!groepen.has(sleutel)) groepen.set(sleutel, []);
      groepen.get(sleutel).push(g);
    });
    geoms = [...groepen.entries()].map(([sleutel,gs])=>{
      const naam = (cfg.groepNaam && cfg.groepNaam[sleutel]) || sleutel;
      if(cfg.groepNaam && !cfg.groepNaam[sleutel]) console.error(`  LET OP: geen NL-naam voor groep "${sleutel}"`);
      return { id:`${cfg.iso}-${slug(naam)}`, naam, geom: gs.length>1 ? mergeArcs(topo, gs) : gs[0] };
    });
  } else {
    geoms = topo.objects.g.geometries.map((g,i)=>{
      const p = feats[i].properties;
      let naam = (p.name_nl || p.name || "").trim();
      if (cfg.naamFix && cfg.naamFix[naam]!==undefined) naam = cfg.naamFix[naam];
      if (cfg.naamFix && cfg.naamFix[p.name]!==undefined) naam = cfg.naamFix[p.name];
      const id = (p.iso_3166_2 && !p.iso_3166_2.includes("~")) ? p.iso_3166_2 : `${cfg.iso}-${slug(naam)}`;
      // afwijkend soort per gebied (territorium, autonome stad…): "de provincie Yukon" zou fout zijn
      const fix = cfg.soortItem ? cfg.soortItem(p) : undefined;
      return { id, naam, geom: g, fix };
    });
  }
  // dubbele ids (zou niet mogen) → volgnummer erachter
  const gezien = new Set();
  for (const g of geoms){ let id=g.id, n=2; while(gezien.has(id)) id=g.id+"_"+n++; gezien.add(id); g.id=id; }

  /* -- 3) simplificeren binnen het puntenbudget (per boog, gedeeld = identiek) -- */
  const pre = presimplify(topo);
  const budget = cfg.budget || BUDGET_STD;
  const gewichten = [];
  for (const arc of pre.arcs) for (let i=1;i<arc.length-1;i++) gewichten.push(arc[i][2]);
  let W = 0;
  if (gewichten.length > budget) { gewichten.sort((a,b)=>b-a); W = gewichten[budget]; }
  const simp = W>0 ? vwSimplify(pre, W) : pre;

  /* -- 4) projectie (LAEA op het land) + passing in het speelvlak -- */
  const alleRingen = [];
  const perGebied = geoms.map(g=>{
    const ft = feature(simp, g.geom);
    const polys = ft.geometry.type==="Polygon" ? [ft.geometry.coordinates] : ft.geometry.coordinates;
    return { ...g, polys };
  });
  for (const g of perGebied) for (const poly of g.polys) for (const r of poly) alleRingen.push(r);
  const [lx0,ly0,lx1,ly1] = bboxVan(alleRingen);
  const lam0 = cfg.lam0!==undefined ? cfg.lam0 : (lx0+lx1)/2;
  const phi1 = cfg.phi1!==undefined ? cfg.phi1 : (ly0+ly1)/2;
  const LAM0=lam0*D, PHI1=phi1*D;
  const proj = ([lon,lat]) => {
    const lam=lon*D, phi=lat*D;
    const k=Math.sqrt(2/(1+Math.sin(PHI1)*Math.sin(phi)+Math.cos(PHI1)*Math.cos(phi)*Math.cos(lam-LAM0)));
    return [ k*Math.cos(phi)*Math.sin(lam-LAM0),
            -(k*(Math.cos(PHI1)*Math.sin(phi)-Math.sin(PHI1)*Math.cos(phi)*Math.cos(lam-LAM0))) ];
  };
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  const geproj = perGebied.map(g => g.polys.map(poly => poly.map(r => r.map(proj))));
  for (const polys of geproj) for (const poly of polys) for (const r of poly) for (const [x,y] of r){
    if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
  }
  const s = Math.min((VB.w-2*VB.marge)/(maxX-minX), (VB.h-2*VB.marge)/(maxY-minY));
  const tx = (VB.w-(maxX-minX)*s)/2 - minX*s, ty = (VB.h-(maxY-minY)*s)/2 - minY*s;
  const fit = ([x,y]) => [x*s+tx, y*s+ty];
  const projFit = ll => fit(proj(ll));

  /* -- 5) paden per gebied (buitenringen + gaten, evenodd) -- */
  const GEO = {}; let punten = 0;
  perGebied.forEach((g,gi)=>{
    const ringen = [];
    for (const poly of geproj[gi]) for (const r of poly){
      const rf = r.map(fit);
      if (rf.length<4) continue;
      if (area(rf) < 0.35) continue; // mini-eilandjes en restsnippers overslaan
      ringen.push(rf.map(p=>[r1(p[0]),r1(p[1])]));
      punten += rf.length;
    }
    if (!ringen.length){ // extreem klein gebied (Ceuta e.d.): bewaar dan tóch de grootste ring
      let best=null,bo=-1;
      for (const poly of geproj[gi]) for (const r of poly){ const rf=r.map(fit); const o=area(rf); if(o>bo){bo=o;best=rf;} }
      if (best){ ringen.push(best.map(p=>[r1(p[0]),r1(p[1])])); punten+=best.length; }
    }
    ringen.sort((a,b)=>area(b)-area(a));
    const bb = bboxVan(ringen).map(r1);
    const [cx,cy] = centroid(ringen[0]).map(r1);
    const g2 = { d: pad(ringen), bb, cx, cy, fr:"evenodd" };
    const maat = Math.max(bb[2]-bb[0], bb[3]-bb[1]);
    if (maat < 7) { g2.dot=[cx,cy]; g2.halo=1; }       // piepklein (Ceuta, DC): stip + klik-halo
    else if (maat < 12) g2.halo=1;
    GEO[g.id] = g2;
  });

  /* -- 6) kleuren: buurgebieden (gedeelde bogen) krijgen duidelijk verschillende tinten -- */
  const boogGebruik = new Map(); // boognr → [gebied-index]
  geoms.forEach((g,i)=>{
    const loop = a => { const j = a<0?~a:a; if(!boogGebruik.has(j)) boogGebruik.set(j,[]); boogGebruik.get(j).push(i); };
    const geom = g.geom;
    const walk = arcs => arcs.forEach(a => Array.isArray(a) ? walk(a) : loop(a));
    walk(geom.arcs);
  });
  const buren = geoms.map(()=>new Set());
  for (const idx of boogGebruik.values()) if (idx.length>1)
    for (const a of idx) for (const b of idx) if (a!==b) buren[a].add(b);
  const hues = new Array(geoms.length).fill(-1);
  const afstand=(a,b)=>{ const d=Math.abs(a-b)%360; return d>180?360-d:d; };
  geoms.forEach((g,i)=>{
    for (let k=0;k<36;k++){
      const hue = Math.round((i*137.508 + 14 + k*61) % 360);
      if (![...buren[i]].some(b=>hues[b]>=0 && afstand(hues[b],hue)<25)){ hues[i]=hue; break; }
    }
    if (hues[i]<0) hues[i] = Math.round((i*137.508+14)%360);
  });
  const items = geoms.map((g,i)=>{
    const it = { id:g.id, n:g.naam, kleur:`hsl(${hues[i]} 62% 60%)` };
    const fix = (cfg.itemFix && cfg.itemFix[g.naam]) || g.fix;
    if (fix){ if(fix.so!==undefined) it.so=fix.so; if(fix.li) it.li=fix.li; }
    return it;
  });
  items.sort((a,b)=>a.n.localeCompare(b.n,"nl"));

  /* -- 7) context (omliggende landen), graticule, startweergave -- */
  const MX_=(lx1-lx0)*0.35+1, MY_=(ly1-ly0)*0.35+1;
  const WIN={ x0:Math.max(-180,lx0-MX_), x1:Math.min(180,lx1+MX_), y0:Math.max(-85,ly0-MY_), y1:Math.min(85,ly1+MY_) };
  let ctxD="";
  for (const f of NE0){
    if (codeVan(f.properties)===cfg.iso) continue;
    const polys = f.geometry.type==="Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const kept=[];
    for (const poly of polys){
      const c=clipRing(poly[0],WIN); if(c.length<3) continue;
      const r=c.map(projFit); if(area(r)<35) continue;
      const k=simplifyDP(r,1.2); if(k.length<3) continue; // context is grijs decor: grof is prima
      if(signedArea(k)<0)k.reverse();
      kept.push(k);
    }
    ctxD+=pad(kept);
  }
  // meren als waterlaag (IJsselmeer, Grote Meren…)
  let merenD="";
  try {
    const MEREN=JSON.parse(readFileSync("meren.geojson","utf8"));
    for (const f of MEREN.features){
      const polys=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
      for (const poly of polys){
        const doeRing=raw=>{ const c=clipRing(raw,WIN); return c.length>=3?c.map(projFit):null; };
        const r=doeRing(poly[0]); if(!r) continue;
        if(area(r)<3) continue;
        const gaten=poly.slice(1).map(doeRing).filter(g=>g&&area(g)>=1);
        const st=[simplifyDP(r,0.6),...gaten.map(g=>simplifyDP(g,0.6))].filter(k=>k.length>=3);
        merenD+=pad(st);
      }
    }
  } catch(e){}
  // graticule: stapgrootte zó dat er ±4-6 lijnen per richting staan
  const stapVan=span=>{ for(const st of [1,2,5,10,15,20,30]) if(span/st<=6) return st; return 45; };
  const stX=stapVan(WIN.x1-WIN.x0), stY=stapVan(WIN.y1-WIN.y0);
  let grat="";
  for (let lon=Math.ceil(WIN.x0/stX)*stX; lon<=WIN.x1; lon+=stX){
    const pts=[]; for(let lat=WIN.y0;lat<=WIN.y1+1e-9;lat+=(WIN.y1-WIN.y0)/40) pts.push(projFit([lon,lat]));
    grat+="M"+pts.map(p=>r1(p[0])+" "+r1(p[1])).join("L");
  }
  for (let lat=Math.ceil(WIN.y0/stY)*stY; lat<=WIN.y1; lat+=stY){
    const pts=[]; for(let lon=WIN.x0;lon<=WIN.x1+1e-9;lon+=(WIN.x1-WIN.x0)/40) pts.push(projFit([lon,lat]));
    grat+="M"+pts.map(p=>r1(p[0])+" "+r1(p[1])).join("L");
  }
  // startweergave: het land vult het beeld
  const landBB = bboxVan(Object.values(GEO).map(g=>[[g.bb[0],g.bb[1]],[g.bb[2],g.bb[3]]]));
  const APAD=14;
  let vw=landBB[2]-landBB[0]+2*APAD, vh=landBB[3]-landBB[1]+2*APAD;
  const ratio=VB.w/VB.h;
  if(vw/vh>ratio){vh=vw/ratio;}else{vw=vh*ratio;}
  let vx=(landBB[0]+landBB[2])/2-vw/2, vy=(landBB[1]+landBB[3])/2-vh/2;
  vx=Math.max(0,Math.min(VB.w-vw,vx)); vy=Math.max(0,Math.min(VB.h-vh,vy));
  const vbstart={x:r1(vx),y:r1(vy),w:r1(Math.min(vw,VB.w)),h:r1(Math.min(vh,VB.h))};

  /* -- 8) wegschrijven -- */
  const PACK={ naam:cfg.naam, f:cfg.f, soort:cfg.soort, lidw:cfg.lidw, soortMv:cfg.soortMv,
               geo:GEO, items, grat, ctx:ctxD, meren:merenD, zee:[], vbstart };
  const json=JSON.stringify(PACK);
  writeFileSync(`data/gebieden/${key}.json`, json);
  totaalBytes+=json.length; totaalPunten+=punten;
  indexUit.push({ key, naam:cfg.naam, f:cfg.f, n:items.length, soortMv:cfg.soortMv });
  console.log(`data/gebieden/${key}.json: ${items.length} ${cfg.soortMv} · ${(punten/1000).toFixed(1)}k punten · ${Math.round(json.length/1024)} KB`);
}

if (doel.length===VOLGORDE.length || doel===VOLGORDE) {
  writeFileSync("data/gebieden/index.json", JSON.stringify(indexUit));
  console.log(`data/gebieden/index.json: ${indexUit.length} landen`);
}
console.log(`totaal: ${(totaalPunten/1000).toFixed(0)}k punten, ${(totaalBytes/1048576).toFixed(2)} MB — vergeet 'node maak-manifest.mjs' niet`);
