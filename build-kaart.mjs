// Zet Natural Earth 50m landgrenzen om naar SVG-paden voor Europa Expeditie.
// Projectie: Lambert azimuthal equal-area, centrum 52N 10E (EU-standaard, EPSG:3035-stijl).
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "ne50m.geojson";
const HTML = "index.html";

const PLAY = ["IS","IE","GB","PT","ES","FR","NL","BE","LU","DE","DK","NO","SE","FI","PL","CZ","AT","CH","IT","GR","HU","HR","SI","SK","EE","LV","LT","BA","RS","ME","XK","AL","MK","BG","RO","MD","UA","BY","RU","TR","CY","MT"];
const CTX  = ["MA","DZ","TN","LY","EG","IL","PS","LB","SY","JO","IQ","SA","IR","GE","AM","AZ","KZ","TM"];
const NAAM2CODE = { "Northern Cyprus":"CY" }; // samenvoegen met Cyprus (kindkaart)
// ministaatjes + Malta als klikbare stip op de hoofdstad
const DOTS = { AD:[1.521,42.507], MC:[7.419,43.731], LI:[9.521,47.141], SM:[12.446,43.936], VA:[12.453,41.902], MT:[14.514,35.899] };

const WIN = { x0:-26, y0:33, x1:52, y1:72.3 };       // lon/lat-venster
const VB = { w:1050, h:920, marge:8 };
const TOL_PLAY = 1.1, TOL_CTX = 2.2;                  // simplify-tolerantie in px
const MIN_RING_PLAY = 20, MIN_RING_CTX = 60;          // px², kleinere ringen vervallen

/* ---------- projectie ---------- */
const D = Math.PI/180, LAM0 = 10*D, PHI1 = 52*D;
function proj([lon,lat]){
  const lam = lon*D, phi = lat*D;
  const k = Math.sqrt(2/(1 + Math.sin(PHI1)*Math.sin(phi) + Math.cos(PHI1)*Math.cos(phi)*Math.cos(lam-LAM0)));
  return [ k*Math.cos(phi)*Math.sin(lam-LAM0),
          -(k*(Math.cos(PHI1)*Math.sin(phi) - Math.sin(PHI1)*Math.cos(phi)*Math.cos(lam-LAM0))) ];
}

/* ---------- polygon-gereedschap ---------- */
function clipRing(ring){ // Sutherland-Hodgman tegen WIN
  const edges = [
    [p=>p[0]>=WIN.x0, (a,b)=>lerpX(a,b,WIN.x0)],
    [p=>p[0]<=WIN.x1, (a,b)=>lerpX(a,b,WIN.x1)],
    [p=>p[1]>=WIN.y0, (a,b)=>lerpY(a,b,WIN.y0)],
    [p=>p[1]<=WIN.y1, (a,b)=>lerpY(a,b,WIN.y1)],
  ];
  let out = ring;
  for(const [inside,cross] of edges){
    const inp = out; out = [];
    for(let i=0;i<inp.length;i++){
      const a = inp[i], b = inp[(i+1)%inp.length];
      if(inside(a)){ out.push(a); if(!inside(b)) out.push(cross(a,b)); }
      else if(inside(b)) out.push(cross(a,b));
    }
    if(out.length<3) return [];
  }
  return out;
}
const lerpX=(a,b,x)=>[x, a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0])];
const lerpY=(a,b,y)=>[a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]), y];

function area(ring){
  let s=0;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];s+=a[0]*b[1]-b[0]*a[1];}
  return Math.abs(s/2);
}
function centroid(ring){
  let s=0,cx=0,cy=0;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],k=a[0]*b[1]-b[0]*a[1];
    s+=k;cx+=(a[0]+b[0])*k;cy+=(a[1]+b[1])*k;
  }
  if(Math.abs(s)<1e-9){const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);return [(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];}
  return [cx/(3*s), cy/(3*s)];
}
function simplify(ring, tol){ // Douglas-Peucker (gesloten ring: splits op verste punt)
  if(ring.length<=4) return ring;
  const t2 = tol*tol;
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
  // start/eind: twee verst uit elkaar liggende punten benaderen met bbox-extremen
  let i0=0,i1=0;
  for(let k=1;k<ring.length;k++){if(ring[k][0]<ring[i0][0])i0=k;if(ring[k][0]>ring[i1][0])i1=k;}
  if(i0===i1)i1=(i0+Math.floor(ring.length/2))%ring.length;
  const [a,b]=[Math.min(i0,i1),Math.max(i0,i1)];
  const keep=new Set([a,b]);
  dp(ring,a,b,keep);
  const wrap=[...ring.slice(b),...ring.slice(0,a+1)];
  const keep2=new Set([0,wrap.length-1]);
  dp(wrap,0,wrap.length-1,keep2);
  const uit=[];
  for(let k=a;k<=b;k++)if(keep.has(k))uit.push(ring[k]);
  for(const k of keep2)if(k>0&&k<wrap.length-1)uit.push(wrap[k]);
  // volgorde herstellen: verzamel indices
  const idx=new Set();
  for(let k=a;k<=b;k++)if(keep.has(k))idx.add(k);
  for(const k of keep2)if(k>0&&k<wrap.length-1)idx.add((b+k)%ring.length);
  return [...idx].sort((p,q)=>p-q).map(k=>ring[k]);
}
const r1=n=>Math.round(n*10)/10;
const pad=d=>d.map(ring=>"M"+ring.map(p=>r1(p[0])+" "+r1(p[1])).join("L")+"Z").join("");

/* ---------- inlezen & selecteren ---------- */
const gj = JSON.parse(readFileSync(SRC,"utf8"));
const perCode = {}; // code -> array van ringen (lon/lat)
for(const f of gj.features){
  const p = f.properties;
  let code = p.ISO_A2 && p.ISO_A2!=="-99" ? p.ISO_A2 : (p.ISO_A2_EH && p.ISO_A2_EH!=="-99" ? p.ISO_A2_EH : null);
  if(NAAM2CODE[p.ADMIN]) code = NAAM2CODE[p.ADMIN];
  if(!code || (!PLAY.includes(code) && !CTX.includes(code))) continue;
  const polys = f.geometry.type==="Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for(const poly of polys){
    const buiten = poly[0]; // alleen buitenring, gaten vervallen
    const geclipt = clipRing(buiten);
    if(geclipt.length>=3) (perCode[code] ||= []).push(geclipt);
  }
}

/* ---------- projecteren & passend maken ---------- */
let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
const geproj = {};
for(const code in perCode){
  geproj[code] = perCode[code].map(r=>r.map(proj));
  for(const r of geproj[code]) for(const [x,y] of r){
    if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
  }
}
const s = Math.min((VB.w-2*VB.marge)/(maxX-minX), (VB.h-2*VB.marge)/(maxY-minY));
const tx = (VB.w-(maxX-minX)*s)/2 - minX*s, ty = (VB.h-(maxY-minY)*s)/2 - minY*s;
const fit = ([x,y])=>[x*s+tx, y*s+ty];
const projFit = ll=>fit(proj(ll));

/* ---------- per land pad bouwen ---------- */
const GEO={}; let totaal=0;
for(const code of PLAY){
  if(DOTS[code]){ GEO[code] = { dot: projFit(DOTS[code]).map(r1) }; continue; }
  const ringen = (geproj[code]||[]).map(r=>r.map(fit));
  if(!ringen.length){ console.error("GEEN GEOMETRIE:",code); continue; }
  ringen.sort((a,b)=>area(b)-area(a));
  const kept = ringen.filter((r,i)=>i===0||area(r)>=MIN_RING_PLAY).map(r=>simplify(r,TOL_PLAY)).filter(r=>r.length>=3);
  let xs=[],ys=[];kept.flat().forEach(p=>{xs.push(p[0]);ys.push(p[1]);});
  const bb=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].map(r1);
  const [cx,cy]=centroid(kept[0]).map(r1);
  const diag=Math.hypot(bb[2]-bb[0],bb[3]-bb[1]);
  GEO[code]={d:pad(kept),bb,cx,cy};
  if(code==="LU"||diag<26)GEO[code].halo=1;
  totaal+=GEO[code].d.length;
  console.log(code, kept.length+" ringen,", GEO[code].d.length+" tekens");
}
/* ministaatjes die niet in PLAY zitten: klikbare stip op de hoofdstad */
for(const code in DOTS){
  if(!GEO[code]) GEO[code] = { dot: projFit(DOTS[code]).map(r1) };
}
/* context als één pad */
let ctxD="";
for(const code of CTX){
  const ringen=(geproj[code]||[]).map(r=>r.map(fit));
  const kept=ringen.filter(r=>area(r)>=MIN_RING_CTX).map(r=>simplify(r,TOL_CTX)).filter(r=>r.length>=3);
  ctxD+=pad(kept);
}
console.log("context:",ctxD.length,"tekens; landen totaal:",totaal);

/* ---------- graticule ---------- */
let grat="";
for(let lon=-20;lon<=50;lon+=10){
  const pts=[];
  for(let lat=WIN.y0;lat<=WIN.y1+1e-9;lat+=0.5)pts.push(projFit([lon,lat]));
  grat+="M"+pts.map(p=>r1(p[0])+" "+r1(p[1])).join("L");
}
for(let lat=40;lat<=70;lat+=10){
  const pts=[];
  for(let lon=WIN.x0;lon<=WIN.x1+1e-9;lon+=0.5)pts.push(projFit([lon,lat]));
  grat+="M"+pts.map(p=>r1(p[0])+" "+r1(p[1])).join("L");
}

/* ---------- zeenamen ---------- */
const ZEE=[["Atlantische Oceaan",-18.5,48.5],["Noordzee",3.3,56.2],["Middellandse Zee",5.6,38.6],["Oostzee",19.6,58.6],["Zwarte Zee",33.8,43.2],["Noordelijke IJszee",5,71.6]]
  .map(([t,lon,lat])=>{const[x,y]=projFit([lon,lat]);return [t,r1(x),r1(y)];});

/* ---------- injecteren in HTML ---------- */
let html=readFileSync(HTML,"utf8");
const blok=`<script id="geodata">
// Echte landgrenzen: Natural Earth 50m (publiek domein), Lambert azimuthal equal-area (52N 10E), vereenvoudigd.
const GEO=${JSON.stringify(GEO)};
const GRATICULE=${JSON.stringify(grat)};
const CONTEXT=${JSON.stringify(ctxD)};
const ZEELABELS=${JSON.stringify(ZEE)};
</${"script"}>`;
html=html.replace(/<script id="geodata">[\s\S]*?<\/script>/,blok);
// oude handgetekende polygonen opruimen (worden niet meer gebruikt)
html=html.replace(/,\n  poly:\[[\s\S]*?\]\]\](,halo:\[\d+,\d+\])?\}/g,"}");
html=html.replace(/,dot:\[\d+,\d+\]\}/g,"}");
writeFileSync(HTML,html);
console.log("HTML bijgewerkt:",html.length,"tekens");
