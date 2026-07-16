// Zet Natural Earth 50m landgrenzen om naar SVG-paden per continent (Europa + Azië).
// Elk continent krijgt zijn eigen Lambert azimuthal equal-area-projectie, passend in 1050×920.
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "ne10m.geojson";   // hoogste Natural Earth-resolutie (1:10m): nauwkeurige grenzen en kustlijnen
const HTML = "index.html";
const VB = { w:1050, h:920, marge:8 };
const TOL_PLAY = 0.55, TOL_CTX = 1.5;
const MIN_RING_PLAY = 5, MIN_RING_CTX = 40;
const D = Math.PI/180;
const r1 = n=>Math.round(n*10)/10;

const NAAM2CODE = { "Northern Cyprus":"CY", "Taiwan":"TW" };

/* ---------- polygon-gereedschap ---------- */
const lerpX=(a,b,x)=>[x, a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0])];
const lerpY=(a,b,y)=>[a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]), y];
function clipRing(ring, WIN){
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
function area(ring){let s=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];s+=a[0]*b[1]-b[0]*a[1];}return Math.abs(s/2);}
function centroid(ring){
  let s=0,cx=0,cy=0;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],k=a[0]*b[1]-b[0]*a[1];s+=k;cx+=(a[0]+b[0])*k;cy+=(a[1]+b[1])*k;}
  if(Math.abs(s)<1e-9){const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);return [(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];}
  return [cx/(3*s), cy/(3*s)];
}
function simplify(ring, tol){
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

const gj = JSON.parse(readFileSync(SRC,"utf8"));

/* ---------- per continent ---------- */
function bouwContinent(cfg){
  const {PLAY, CTX, DOTS, WIN, lam0, phi1, ankers, zeenamen, gratLon, gratLat} = cfg;
  const LAM0=lam0*D, PHI1=phi1*D;
  const proj=([lon,lat])=>{
    const lam=lon*D, phi=lat*D;
    const k=Math.sqrt(2/(1+Math.sin(PHI1)*Math.sin(phi)+Math.cos(PHI1)*Math.cos(phi)*Math.cos(lam-LAM0)));
    return [ k*Math.cos(phi)*Math.sin(lam-LAM0),
            -(k*(Math.cos(PHI1)*Math.sin(phi)-Math.sin(PHI1)*Math.cos(phi)*Math.cos(lam-LAM0))) ];
  };
  const wanted=new Set([...PLAY,...CTX,...Object.keys(DOTS)]);
  const perCode={};
  for(const f of gj.features){
    const p=f.properties;
    let code=p.ISO_A2&&p.ISO_A2!=="-99"?p.ISO_A2:(p.ISO_A2_EH&&p.ISO_A2_EH!=="-99"?p.ISO_A2_EH:null);
    if(NAAM2CODE[p.ADMIN]) code=NAAM2CODE[p.ADMIN];
    if(!code||!wanted.has(code)) continue;
    const polys=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
    for(const poly of polys){
      const geclipt=clipRing(poly[0],WIN);
      if(geclipt.length>=3)(perCode[code] ||= []).push(geclipt);
    }
  }
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  const geproj={};
  for(const code in perCode){
    geproj[code]=perCode[code].map(r=>r.map(proj));
    for(const r of geproj[code]) for(const [x,y] of r){ if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y; }
  }
  const s=Math.min((VB.w-2*VB.marge)/(maxX-minX),(VB.h-2*VB.marge)/(maxY-minY));
  const tx=(VB.w-(maxX-minX)*s)/2-minX*s, ty=(VB.h-(maxY-minY)*s)/2-minY*s;
  const fit=([x,y])=>[x*s+tx,y*s+ty];
  const projFit=ll=>fit(proj(ll));

  const GEO={};
  function dotLand(code){ // ministaatje: klik-stip + (waar zichtbaar) de échte vorm eronder
    const g={dot:projFit(DOTS[code]).map(r1)};
    const ringen=(geproj[code]||[]).map(r=>r.map(fit));
    if(ringen.length){
      ringen.sort((a,b)=>area(b)-area(a));
      const kept=ringen.filter((r,i)=>i===0||area(r)>=2).map(r=>simplify(r,TOL_PLAY*0.5)).filter(r=>r.length>=3);
      if(kept.length&&area(kept[0])>=0.8)g.d=pad(kept);
    }
    return g;
  }
  for(const code of PLAY){
    if(DOTS[code]){ GEO[code]=dotLand(code); continue; }
    const ringen=(geproj[code]||[]).map(r=>r.map(fit));
    if(!ringen.length){ console.error("  GEEN GEOMETRIE:",code); continue; }
    ringen.sort((a,b)=>area(b)-area(a));
    const kept=ringen.filter((r,i)=>i===0||area(r)>=MIN_RING_PLAY).map(r=>simplify(r,TOL_PLAY)).filter(r=>r.length>=3);
    let xs=[],ys=[];kept.flat().forEach(p=>{xs.push(p[0]);ys.push(p[1]);});
    const bb=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].map(r1);
    const [cx,cy]=centroid(kept[0]).map(r1);
    const diag=Math.hypot(bb[2]-bb[0],bb[3]-bb[1]);
    GEO[code]={d:pad(kept),bb,cx,cy};
    if(diag<26)GEO[code].halo=1;
  }
  for(const code in DOTS){ if(!GEO[code]) GEO[code]=dotLand(code); }

  let ctxD="";
  for(const code of CTX){
    const ringen=(geproj[code]||[]).map(r=>r.map(fit));
    const kept=ringen.filter(r=>area(r)>=MIN_RING_CTX).map(r=>simplify(r,TOL_CTX)).filter(r=>r.length>=3);
    ctxD+=pad(kept);
  }
  // graticule
  let grat="";
  for(const lon of gratLon){ const pts=[]; for(let lat=WIN.y0;lat<=WIN.y1+1e-9;lat+=0.5)pts.push(projFit([lon,lat])); grat+="M"+pts.map(p=>r1(p[0])+" "+r1(p[1])).join("L"); }
  for(const lat of gratLat){ const pts=[]; for(let lon=WIN.x0;lon<=WIN.x1+1e-9;lon+=0.5)pts.push(projFit([lon,lat])); grat+="M"+pts.map(p=>r1(p[0])+" "+r1(p[1])).join("L"); }
  // startweergave
  let ax0=1e9,ay0=1e9,ax1=-1e9,ay1=-1e9;
  const ankerPunten = ankers ? ankers.map(projFit)
    : PLAY.filter(c=>GEO[c]&&GEO[c].bb).flatMap(c=>{const b=GEO[c].bb;return [[b[0],b[1]],[b[2],b[3]]];});
  for(const [x,y] of ankerPunten){ if(x<ax0)ax0=x;if(x>ax1)ax1=x;if(y<ay0)ay0=y;if(y>ay1)ay1=y; }
  const APAD=14;
  let vw=ax1-ax0+2*APAD, vh=ay1-ay0+2*APAD;
  const ratio=VB.w/VB.h;
  if(vw/vh>ratio){vh=vw/ratio;}else{vw=vh*ratio;}
  let vx=(ax0+ax1)/2-vw/2, vy=(ay0+ay1)/2-vh/2;
  vx=Math.max(0,Math.min(VB.w-vw,vx)); vy=Math.max(0,Math.min(VB.h-vh,vy));
  const vbstart={x:r1(vx),y:r1(vy),w:r1(Math.min(vw,VB.w)),h:r1(Math.min(vh,VB.h))};
  const zee=zeenamen.map(([t,lon,lat])=>{const[x,y]=projFit([lon,lat]);return [t,r1(x),r1(y)];});

  const tot=Object.values(GEO).reduce((a,g)=>a+(g.d?g.d.length:0),0);
  console.log(`  ${PLAY.length} landen, ${tot} tekens paden, ${ctxD.length} tekens context, start`,vbstart);
  return {geo:GEO, grat, ctx:ctxD, zee, vbstart};
}

/* ---------- Europa (ongewijzigde parameters) ---------- */
console.log("EUROPA:");
const EU = bouwContinent({
  PLAY:["IS","IE","GB","PT","ES","FR","NL","BE","LU","DE","DK","NO","SE","FI","PL","CZ","AT","CH","IT","GR","HU","HR","SI","SK","EE","LV","LT","BA","RS","ME","XK","AL","MK","BG","RO","MD","UA","BY","RU","TR","CY","MT"],
  CTX:["MA","DZ","TN","LY","EG","IL","PS","LB","SY","JO","IQ","SA","IR","GE","AM","AZ","KZ","TM"],
  DOTS:{ AD:[1.521,42.507], MC:[7.419,43.731], LI:[9.521,47.141], SM:[12.446,43.936], VA:[12.453,41.902], MT:[14.514,35.899] },
  WIN:{ x0:-26, y0:33, x1:52, y1:72.3 },
  lam0:10, phi1:52,
  ankers:[[-24.6,66.6],[-24.6,63.3],[-9.7,37.0],[-10.5,51.4],[25.8,71.25],[31.1,69.8],[34.9,34.4],[14.2,35.7],[24.8,34.8],[40.5,56.2],[41.7,41.5]],
  zeenamen:[["Atlantische Oceaan",-18.5,48.5],["Noordzee",3.3,56.2],["Middellandse Zee",5.6,38.6],["Oostzee",19.6,58.6],["Zwarte Zee",33.8,43.2],["Noordelijke IJszee",5,71.6]],
  gratLon:[-20,-10,0,10,20,30,40,50], gratLat:[40,50,60,70],
});

/* ---------- Azië ---------- */
console.log("AZIË:");
const AS = bouwContinent({
  PLAY:["CN","JP","IN","ID","TH","VN","KR","SA","PK","PH","MY","IR","IQ","AF","MN","NP","BD","LK","KP","TW","MM","KH","LA","BT","KZ","UZ","TM","KG","TJ","IL","JO","LB","SY","YE","OM","AE","QA","KW","GE","AM","AZ","TL","SG","BH","MV","BN"],
  CTX:["RU","TR","EG","SD","CY"],
  DOTS:{ SG:[103.82,1.29], BH:[50.58,26.22], MV:[73.51,4.17] },
  WIN:{ x0:31, y0:-12, x1:151, y1:56 },
  lam0:88, phi1:30,
  zeenamen:[["Indische Oceaan",78,-8],["Stille Oceaan",140,18],["Zuid-Chinese Zee",115,12],["Golf van Bengalen",89,13],["Arabische Zee",63,14],["Kaspische Zee",51,41],["Japanse Zee",135,40]],
  gratLon:[40,60,80,100,120,140], gratLat:[0,10,20,30,40,50],
});

/* ---------- datapacks schrijven (daarna: node maak-manifest.mjs) ---------- */
writeFileSync("data/continents/europa.json",JSON.stringify(EU));
writeFileSync("data/continents/azie.json",JSON.stringify(AS));
console.log("packs geschreven: data/continents/europa.json + azie.json — vergeet 'node maak-manifest.mjs' niet");
