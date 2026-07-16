// Landmodus-pijplijn (fase 3): bouwt per land een gedetailleerd kaartpack + stedenlijst.
// Bron kaart: geoBoundaries gbOpen ADM0 (voor NL: CC0, Nationaal Georegister/Kadaster — hoog detail).
// Bron steden: GeoNames cities15000 (CC BY 4.0).
// Gebruik: node build-land.mjs NL   → data/landen/nederland.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import pc from "polygon-clipping";
import { execSync } from "node:child_process";

const LAND = process.argv[2] || "NL";
const CFG = {
  NL: {
    iso3: "NLD", naam: "Nederland", bestand: "nederland",
    bron: "nl_pdok.geojson", bronType: "pdok-gemeenten", // CBS wijkenbuurten (land-variant, kadaster-detail)
    lam0: 5.4, phi1: 52.15,
    WIN: { x0: 2.4, y0: 50.2, x1: 8.5, y1: 54.2 },   // venster voor context/meren (lon/lat)
    ctx: ["DE", "BE", "GB", "FR"],
    zeenamen: [["Noordzee", 3.4, 53.0], ["Waddenzee", 5.15, 53.32], ["IJsselmeer", 5.32, 52.78]],
    gratLon: [4, 5, 6, 7], gratLat: [51, 52, 53],
    // naamcorrecties + uitsluitingen voor de GeoNames-stedenlijst
    naamFix: { "The Hague": "Den Haag", "Almere Stad": "Almere", "Zaanstad": "Zaandam" },
    skip: new Set(["Amsterdam-Zuidoost", "Loosduinen", "Scheveningen", "Segbroek", "Ypenburg", "Leidschenveen", "Hoge Vucht", "Krispijn"]),
  },
}[LAND];
if (!CFG) throw new Error("onbekend land: " + LAND);

const VB = { w: 1050, h: 920, marge: 8 };
const D = Math.PI / 180;
const r1 = n => Math.round(n * 10) / 10;

/* ---------- gereedschap (zelfde als build-kaart) ---------- */
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
function area(ring){let s=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];s+=a[0]*b[1]-b[0]*a[1];}return Math.abs(s/2);}
function centroid(ring){
  let s=0,cx=0,cy=0;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],k=a[0]*b[1]-b[0]*a[1];s+=k;cx+=(a[0]+b[0])*k;cy+=(a[1]+b[1])*k;}
  if(Math.abs(s)<1e-9){const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);return [(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];}
  return [cx/(3*s), cy/(3*s)];
}
function simplify(ring, tol){
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
  let i0=0,i1=0;
  for(let k=1;k<ring.length;k++){if(ring[k][0]<ring[i0][0])i0=k;if(ring[k][0]>ring[i1][0])i1=k;}
  if(i0===i1)i1=(i0+Math.floor(ring.length/2))%ring.length;
  const [a,b]=[Math.min(i0,i1),Math.max(i0,i1)];
  const keep=new Set([a,b]); dp(ring,a,b,keep);
  const wrap=[...ring.slice(b),...ring.slice(0,a+1)];
  const keep2=new Set([0,wrap.length-1]); dp(wrap,0,wrap.length-1,keep2);
  const idx=new Set();
  for(let k=a;k<=b;k++)if(keep.has(k))idx.add(k);
  for(const k of keep2)if(k>0&&k<wrap.length-1)idx.add((b+k)%ring.length);
  return [...idx].sort((p,q)=>p-q).map(k=>ring[k]);
}
const pad=d=>d.map(ring=>"M"+ring.map(p=>r1(p[0])+" "+r1(p[1])).join("L")+"Z").join("");

/* ---------- projectie (LAEA op het land) ---------- */
const LAM0=CFG.lam0*D, PHI1=CFG.phi1*D;
const proj=([lon,lat])=>{
  const lam=lon*D, phi=lat*D;
  const k=Math.sqrt(2/(1+Math.sin(PHI1)*Math.sin(phi)+Math.cos(PHI1)*Math.cos(phi)*Math.cos(lam-LAM0)));
  return [ k*Math.cos(phi)*Math.sin(lam-LAM0),
          -(k*(Math.cos(PHI1)*Math.sin(phi)-Math.sin(PHI1)*Math.cos(phi)*Math.cos(lam-LAM0))) ];
};

/* ---------- 1) het land zelf: gemeente-landvlakken → topologie → één vlak zonder kieren ---------- */
const bron=JSON.parse(readFileSync(CFG.bron,"utf8"));
const gemeenten=bron.features.filter(f=>f.geometry&&(CFG.bronType!=="pdok-gemeenten"||f.properties.water==="NEE"));
console.log(`bron: ${gemeenten.length} landvlakken`);
// projecteer alles eerst om de fit (schaal) op het LAND te bepalen
let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
const geprojFeats=gemeenten.map(f=>{
  const g=f.geometry;
  const polys=g.type==="Polygon"?[g.coordinates]:g.coordinates;
  return polys.map(poly=>poly.map(r=>r.map(proj)));
});
for(const polys of geprojFeats)for(const poly of polys)for(const r of poly)for(const [x,y] of r){
  if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
}
const s=Math.min((VB.w-2*VB.marge)/(maxX-minX),(VB.h-2*VB.marge)/(maxY-minY));
const tx=(VB.w-(maxX-minX)*s)/2-minX*s, ty=(VB.h-(maxY-minY)*s)/2-minY*s;
const fit=([x,y])=>[x*s+tx,y*s+ty];
const projFit=ll=>fit(proj(ll));

// gemeenten samensmelten tot één landvlak via booleaanse union (martinez): binnengrenzen
// verdwijnen exact (bron-grenzen zijn identiek gedeeld), daarna pas vereenvoudigen — geen artefacten
const TOL_LAND=0.15; // DP-tolerantie in px (≈50 m op NL-schaal)
// coördinaten op een fijn raster (0,01 px ≈ 3,5 m): gedeelde grenzen blijven exact gelijk
// en bijna-samenvallende punten (drijvende-komma-ruis) verdwijnen → robuuste union
const snap=([x,y])=>[Math.round(x*100)/100,Math.round(y*100)/100];
const schoonRing=r=>{
  const uit=[];
  for(const pt of r.map(snap)){
    const v=uit[uit.length-1];
    if(!v||v[0]!==pt[0]||v[1]!==pt[1])uit.push(pt);
  }
  if(uit.length>1&&uit[0][0]===uit[uit.length-1][0]&&uit[0][1]===uit[uit.length-1][1])uit.pop();
  return uit;
};
const multipolys=geprojFeats.map(polys=>
  polys.map(poly=>poly.map(r=>schoonRing(r.map(fit))).filter(r=>r.length>=3)).filter(p=>p.length)
).filter(mp=>mp.length);
console.log("union over",multipolys.length,"gemeenten (gefaseerd)...");
let tussen=[];
for(let i=0;i<multipolys.length;i+=25){
  const groep=multipolys.slice(i,i+25);
  tussen.push(groep.length>1?pc.union(...groep):groep[0]);
  process.stdout.write(`\r  groep ${Math.min(i+25,multipolys.length)}/${multipolys.length}   `);
}
console.log("");
let unie=tussen[0];
for(let i=1;i<tussen.length;i++){
  unie=pc.union(unie,tussen[i]);
  process.stdout.write(`\r  samenvoegen ${i}/${tussen.length-1}   `);
}
console.log("");
const ringKruist=r=>{
  const kr=(a,b,c,e)=>{
    const d1=(e[0]-c[0])*(a[1]-c[1])-(e[1]-c[1])*(a[0]-c[0]);
    const d2=(e[0]-c[0])*(b[1]-c[1])-(e[1]-c[1])*(b[0]-c[0]);
    const d3=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const d4=(b[0]-a[0])*(e[1]-a[1])-(b[1]-a[1])*(e[0]-a[0]);
    return d1*d2<0&&d3*d4<0;
  };
  for(let i=0;i<r.length;i++){
    const a=r[i],b=r[(i+1)%r.length];
    for(let j=i+2;j<r.length;j++){
      if(i===0&&j===r.length-1)continue;
      if(kr(a,b,r[j],r[(j+1)%r.length]))return true;
    }
  }
  return false;
};
const kruisCheck=(ringen,label)=>{
  const kr=(a,b,c,e)=>{
    const d1=(e[0]-c[0])*(a[1]-c[1])-(e[1]-c[1])*(a[0]-c[0]);
    const d2=(e[0]-c[0])*(b[1]-c[1])-(e[1]-c[1])*(b[0]-c[0]);
    const d3=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const d4=(b[0]-a[0])*(e[1]-a[1])-(b[1]-a[1])*(e[0]-a[0]);
    return d1*d2<0&&d3*d4<0;
  };
  let micro=0,macro=0,vb=null;
  for(const r of ringen){
    for(let i=0;i<r.length;i++){
      const a=r[i],b=r[(i+1)%r.length];
      for(let j=i+2;j<r.length;j++){
        if(i===0&&j===r.length-1)continue;
        const c=r[j],e=r[(j+1)%r.length];
        if(kr(a,b,c,e)){
          const sch=Math.max(Math.hypot(b[0]-a[0],b[1]-a[1]),Math.hypot(e[0]-c[0],e[1]-c[1]));
          if(sch<1)micro++;else{macro++;if(!vb||sch>vb.sch)vb={sch,a};}
        }
      }
    }
  }
  console.log(`[${label}] micro:${micro} macro:${macro}`+(vb?` grootste ${vb.sch.toFixed(1)}px bij (${vb.a[0].toFixed(1)},${vb.a[1].toFixed(1)})`:""));
};
if(process.env.DEBUG_KRUIS){
  const rauw=[],simp=[];
  for(const poly of unie)for(const r of poly){rauw.push(r);const k=simplify(r,TOL_LAND);if(k.length>=3)simp.push(k);}
  kruisCheck(rauw,"na union");
  kruisCheck(simp,"na DP-simplify");
}
const landRingen=[];
for(const poly of unie){
  for(const [i,r] of poly.entries()){
    if(!r||r.length<4)continue;
    if(area(r)<(i===0?0.35:0.25))continue; // mini-spikkels; gaten (plassen) blijven
    // vereenvoudigen kan in smalle zeegaten sub-pixel-zelfkruisingen maken; die zijn
    // onschuldig doordat het landvlak met fill-rule nonzero wordt getekend (fr hieronder)
    const k=simplify(r,TOL_LAND);
    if(k.length>=3)landRingen.push(k);
  }
}
landRingen.sort((a,b)=>area(b)-area(a));
let xs=[],ys=[];landRingen.flat().forEach(p=>{xs.push(p[0]);ys.push(p[1]);});
let bx0=1/0,by0=1/0,bx1=-1/0,by1=-1/0;
for(const x of xs){if(x<bx0)bx0=x;if(x>bx1)bx1=x;}
for(const y of ys){if(y<by0)by0=y;if(y>by1)by1=y;}
const bb=[bx0,by0,bx1,by1].map(r1);
const [cx,cy]=centroid(landRingen[0]).map(r1);
const GEO={}; GEO[LAND]={d:pad(landRingen),bb,cx,cy,fr:"nonzero"};

/* ---------- 2) context (buurlanden, uit Natural Earth) ---------- */
const NAAM2CODE={ "Northern Cyprus":"CY", "Taiwan":"TW", "Somaliland":"SO" };
const ne=JSON.parse(readFileSync("ne10m.geojson","utf8"));
let ctxD="";
for(const f of ne.features){
  const p=f.properties;
  let code=p.ISO_A2&&p.ISO_A2!=="-99"?p.ISO_A2:(p.ISO_A2_EH&&p.ISO_A2_EH!=="-99"?p.ISO_A2_EH:null);
  if(NAAM2CODE[p.ADMIN])code=NAAM2CODE[p.ADMIN];
  if(!code||!CFG.ctx.includes(code))continue;
  const polys=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
  const kept=[];
  for(const poly of polys){
    const c=clipRing(poly[0],CFG.WIN);
    if(c.length<3)continue;
    const r=c.map(proj).map(fit);
    if(area(r)<20)continue;
    const k=simplify(r,0.5);
    if(k.length>=3)kept.push(k);
  }
  ctxD+=pad(kept);
}

/* ---------- 3) meren — bij pdok-gemeenten overbodig (water is al uitgespaard) ---------- */
const MEREN=CFG.bronType==="pdok-gemeenten"?{features:[]}:JSON.parse(readFileSync("meren.geojson","utf8"));
let merenD="";
for(const f of MEREN.features){
  const polys=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
  for(const poly of polys){
    const doeRing=raw=>{const c=clipRing(raw,CFG.WIN);return c.length>=3?c.map(proj).map(fit):null;};
    const r=doeRing(poly[0]); if(!r)continue;
    if(area(r)<1.5)continue;
    const gaten=poly.slice(1).map(doeRing).filter(g=>g&&area(g)>=0.5);
    const st=[simplify(r,TOL_LAND),...gaten.map(g=>simplify(g,TOL_LAND))].filter(k=>k.length>=3);
    merenD+=pad(st);
  }
}

/* ---------- 4) graticule, zeelabels, startweergave ---------- */
let grat="";
for(const lon of CFG.gratLon){ const pts=[]; for(let lat=CFG.WIN.y0;lat<=CFG.WIN.y1+1e-9;lat+=0.25)pts.push(projFit([lon,lat])); grat+="M"+pts.map(p=>r1(p[0])+" "+r1(p[1])).join("L"); }
for(const lat of CFG.gratLat){ const pts=[]; for(let lon=CFG.WIN.x0;lon<=CFG.WIN.x1+1e-9;lon+=0.25)pts.push(projFit([lon,lat])); grat+="M"+pts.map(p=>r1(p[0])+" "+r1(p[1])).join("L"); }
const zee=CFG.zeenamen.map(([t,lon,lat])=>{const[x,y]=projFit([lon,lat]);return [t,r1(x),r1(y)];});
const APAD=14;
let vw=bb[2]-bb[0]+2*APAD, vh=bb[3]-bb[1]+2*APAD;
const ratio=VB.w/VB.h;
if(vw/vh>ratio){vh=vw/ratio;}else{vw=vh*ratio;}
let vx=(bb[0]+bb[2])/2-vw/2, vy=(bb[1]+bb[3])/2-vh/2;
vx=Math.max(0,Math.min(VB.w-vw,vx)); vy=Math.max(0,Math.min(VB.h-vh,vy));
const vbstart={x:r1(vx),y:r1(vy),w:r1(Math.min(vw,VB.w)),h:r1(Math.min(vh,VB.h))};

/* ---------- 5) steden uit GeoNames (top 50, gecureerd) ---------- */
execSync("unzip -o -q cities15000.zip cities15000.txt");
const rijen=readFileSync("cities15000.txt","utf8").trim().split("\n").map(r=>r.split("\t"));
const OKCODES=new Set(["PPLC","PPLG","PPLA","PPLA2","PPLA3","PPL"]); // PPLG = regeringszetel (Den Haag!)
const kandidaten=rijen
  .filter(r=>r[8]===LAND && OKCODES.has(r[7]))
  .map(r=>({n:CFG.naamFix[r[1]]||r[1], lat:+r[4], lon:+r[5], p:+r[14]}))
  .filter(st=>!CFG.skip.has(st.n))
  .sort((a,b)=>b.p-a.p);
const gezien=new Set(); const steden=[];
for(const st of kandidaten){
  if(gezien.has(st.n))continue; gezien.add(st.n);
  const [x,y]=projFit([st.lon,st.lat]);
  steden.push({n:st.n, x:r1(x), y:r1(y), p:st.p});
  if(steden.length>=50)break;
}

/* ---------- wegschrijven ---------- */
const PACK={geo:GEO, grat, ctx:ctxD, zee, vbstart, meren:merenD, steden, naam:CFG.naam};
writeFileSync(`data/landen/${CFG.bestand}.json`,JSON.stringify(PACK));

/* ---------- globe-overlay: dezelfde ringen terug naar lon/lat (tier-4 op de wereldbol) ---------- */
const invFit=([px,py])=>[(px-tx)/s,(py-ty)/s];
const invProj=([X,Yneg])=>{ // inverse LAEA (bolvorm, zelfde lam0/phi1)
  const Y=-Yneg, rho=Math.hypot(X,Y);
  if(rho<1e-12)return [CFG.lam0,CFG.phi1];
  const c=2*Math.asin(Math.min(1,rho/2));
  const phi=Math.asin(Math.cos(c)*Math.sin(PHI1)+Y*Math.sin(c)*Math.cos(PHI1)/rho);
  const lam=LAM0+Math.atan2(X*Math.sin(c), rho*Math.cos(c)*Math.cos(PHI1)-Y*Math.sin(c)*Math.sin(PHI1));
  return [lam/D, phi/D];
};
const r4=v=>Math.round(v*1e4)/1e4; // 0,0001° ≈ 11 m — ruim onder de simplify-tolerantie
const globeRingen=landRingen.map(r=>r.map(p=>invProj(invFit(p)).map(r4)));
writeFileSync(`data/landen/${CFG.bestand}-globe.json`,JSON.stringify({[LAND]:globeRingen}));
console.log(`globe-overlay: data/landen/${CFG.bestand}-globe.json (${globeRingen.reduce((n,r)=>n+r.length,0)} punten)`);
const punten=landRingen.reduce((a,r)=>a+r.length,0);
console.log(`${CFG.naam}: ${landRingen.length} ringen, ${punten} punten, ${steden.length} steden`);
console.log(`top-10 steden: ${steden.slice(0,10).map(s=>s.n).join(", ")}`);
console.log(`pack: data/landen/${CFG.bestand}.json (${Math.round(JSON.stringify(PACK).length/1024)} KB) — vergeet 'node maak-manifest.mjs' niet`);
