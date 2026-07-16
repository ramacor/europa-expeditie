// Genereert ruwe lon/lat-geometrie voor de 3D-globe: speelbare landen (EU+AS) apart,
// de rest van de wereld als neutrale landmassa. Injecteert GLOBE in index/europa-expeditie.html.
import { readFileSync, writeFileSync } from "node:fs";
import { topology } from "topojson-server";
import { presimplify, simplify as vwSimplify } from "topojson-simplify";
import { feature } from "topojson-client";
const SRC="ne10m.geojson"; // hoogste resolutie (1:10m)
const HTML="index.html";

import { WERELD } from "./bron-wereld.mjs";
const EU=["IS","IE","GB","PT","ES","FR","NL","BE","LU","DE","DK","NO","SE","FI","PL","CZ","AT","CH","IT","GR","HU","HR","SI","SK","EE","LV","LT","BA","RS","ME","XK","AL","MK","BG","RO","MD","UA","BY","RU","TR","CY","MT","AD","MC","LI","SM","VA"];
const AS=["CN","JP","IN","ID","TH","VN","KR","SA","PK","PH","MY","IR","IQ","AF","MN","NP","BD","LK","KP","TW","MM","KH","LA","BT","KZ","UZ","TM","KG","TJ","IL","JO","LB","SY","YE","OM","AE","QA","KW","GE","AM","AZ","TL","SG","BH","MV","BN"];
const PLAY=new Set([...EU,...AS,...WERELD.map(l=>l.id)]);
const CONT={}; EU.forEach(c=>CONT[c]="EU"); AS.forEach(c=>CONT[c]="AS"); WERELD.forEach(l=>CONT[l.id]=l.cont);
const NAAM2CODE={ "Northern Cyprus":"CY", "Taiwan":"TW", "Somaliland":"SO" };
// hoofdstad-coördinaten voor de nieuwe landen uit Natural Earth populated places (+ cap-overrides)
const KAP={};
try{
  const pp=JSON.parse(readFileSync("steden.geojson","utf8"));
  const iso3naar2=Object.fromEntries(WERELD.map(l=>[l.iso3,l.id]));
  for(const f of pp.features){const q=f.properties;
    if(!String(q.FEATURECLA||"").startsWith("Admin-0 capital"))continue;
    const id=iso3naar2[q.ADM0_A3];
    if(id&&!KAP[id])KAP[id]=f.geometry.coordinates.map(v=>Math.round(v*100)/100);}
}catch(e){console.error("steden.geojson ontbreekt");}
for(const l of WERELD)if(l.cap)KAP[l.id]=l.cap;
// hoofdstad-coords voor landen die te klein zijn voor een polygoon (stip op de globe)
const DOTS={ AD:[1.52,42.51], MC:[7.42,43.73], LI:[9.52,47.14], SM:[12.45,43.94], VA:[12.45,41.90], MT:[14.51,35.90],
             SG:[103.82,1.29], BH:[50.58,26.22], MV:[73.51,4.17] };
for(const l of WERELD)if(l.dot){ if(!KAP[l.id])throw new Error("geen hoofdstad-coördinaat voor dot-land "+l.id); DOTS[l.id]=KAP[l.id]; }

const r1=n=>Math.round(n*10)/10;
function area(r){let s=0;for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];s+=a[0]*b[1]-b[0]*a[1];}return Math.abs(s/2);}
function simplify(ring,tol){
  if(ring.length<=4)return ring;
  const t2=tol*tol;
  const dp=(pts,i,j,keep)=>{let mx=-1,mi=-1;const ax=pts[i][0],ay=pts[i][1],bx=pts[j][0],by=pts[j][1];const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy||1e-12;
    for(let k=i+1;k<j;k++){const t=Math.max(0,Math.min(1,((pts[k][0]-ax)*dx+(pts[k][1]-ay)*dy)/len2));const px=ax+t*dx-pts[k][0],py=ay+t*dy-pts[k][1],d2=px*px+py*py;if(d2>mx){mx=d2;mi=k;}}
    if(mx>t2){keep.add(mi);dp(pts,i,mi,keep);dp(pts,mi,j,keep);}};
  let i0=0,i1=0;for(let k=1;k<ring.length;k++){if(ring[k][0]<ring[i0][0])i0=k;if(ring[k][0]>ring[i1][0])i1=k;}
  if(i0===i1)i1=(i0+Math.floor(ring.length/2))%ring.length;
  const [a,b]=[Math.min(i0,i1),Math.max(i0,i1)];
  const keep=new Set([a,b]);dp(ring,a,b,keep);
  const wrap=[...ring.slice(b),...ring.slice(0,a+1)];const keep2=new Set([0,wrap.length-1]);dp(wrap,0,wrap.length-1,keep2);
  const idx=new Set();for(let k=a;k<=b;k++)if(keep.has(k))idx.add(k);for(const k of keep2)if(k>0&&k<wrap.length-1)idx.add((b+k)%ring.length);
  return [...idx].sort((p,q)=>p-q).map(k=>ring[k]);
}
const r2=n=>Math.round(n*100)/100;
const round=ring=>ring.map(([lo,la])=>[r2(lo),r2(la)]);
const r3=n=>Math.round(n*1000)/1000;
const round3=ring=>ring.map(([lo,la])=>[r3(lo),r3(la)]); // max-niveau: fijnere afronding, anders trapjes bij diep zoomen

const gj=JSON.parse(readFileSync(SRC,"utf8"));
// 1) ringen verzamelen (met area-voorfilter), NOG NIET vereenvoudigen
const perCode={}, restRingen=[];
for(const f of gj.features){
  const p=f.properties;
  let code=p.ISO_A2&&p.ISO_A2!=="-99"?p.ISO_A2:(p.ISO_A2_EH&&p.ISO_A2_EH!=="-99"?p.ISO_A2_EH:null);
  if(NAAM2CODE[p.ADMIN])code=NAAM2CODE[p.ADMIN];
  const speel=code&&PLAY.has(code);
  const polys=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
  for(const poly of polys){
    const ring=poly[0];
    if(!ring||ring.length<4)continue;
    const A=area(ring);
    if(A < (speel?0.0002:0.15))continue;           // kleine eilandjes mee (fijn niveau toont ze; grof filtert na extractie)
    if(speel)(perCode[code] ||= []).push(ring);
    else restRingen.push(ring);
  }
}
// 2) topologie: gedeelde grenzen worden één boog en dus één keer vereenvoudigd → buurlanden sluiten exact aan (geen kieren)
const feats=Object.entries(perCode).map(([code,ringen])=>({type:"Feature",id:code,properties:{},geometry:{type:"MultiPolygon",coordinates:ringen.map(r=>[r])}}));
const topo=topology({
  landen:{type:"FeatureCollection",features:feats},
  rest:{type:"MultiPolygon",coordinates:restRingen.map(r=>[r])}
},1e6);
const W_GLOBE=0.014, W_GLOBE_FIJN=0.0015, W_GLOBE_MAX=0.00008; // drempels: overzicht / ingezoomd / diep ingezoomd (vrijwel bronniveau)
const pre=presimplify(topo);
const simp=vwSimplify(pre,W_GLOBE);
const simpF=vwSimplify(pre,W_GLOBE_FIJN);
const simpM=vwSimplify(pre,W_GLOBE_MAX);
// 3) uitpakken en afronden (identieke coördinaten ronden identiek af → aansluiting blijft exact)
const landen={}, rest=[], landenFijn={};
for(const f2 of feature(simp,simp.objects.landen).features){
  const ringen=f2.geometry.coordinates.map(pg=>pg[0]).filter(r=>r&&r.length>=4)
    .filter((r,i)=>i===0||area(r)>=0.0008); // grof: piepkleine eilandjes overslaan (fijn toont ze wél)
  if(ringen.length)landen[f2.id]=ringen.map(round);
}
for(const f2 of feature(simpF,simpF.objects.landen).features){
  const ringen=f2.geometry.coordinates.map(pg=>pg[0]).filter(r=>r&&r.length>=4);
  if(ringen.length)landenFijn[f2.id]=ringen.map(round);
}
const landenMax={};
for(const f2 of feature(simpM,simpM.objects.landen).features){
  const ringen=f2.geometry.coordinates.map(pg=>pg[0]).filter(r=>r&&r.length>=4);
  if(ringen.length)landenMax[f2.id]=ringen.map(round3);
}
for(const pg of feature(simp,simp.objects.rest).geometry.coordinates){
  const r=pg[0]; if(r&&r.length>=4)rest.push(round(r));
}
// stippen voor mini-landen zonder (bewaarde) polygoon
const dots={};
for(const code in DOTS){ dots[code]=DOTS[code]; } // stip blijft altijd zichtbaar als marker

// hoofdstad-locaties [lon,lat] — voor stipjes + namen op de globe (namen komen uit LANDEN.h)
const STEDEN={
 NL:[4.9,52.37],BE:[4.35,50.85],LU:[6.13,49.61],DE:[13.40,52.52],FR:[2.35,48.86],ES:[-3.70,40.42],PT:[-9.14,38.72],
 IT:[12.50,41.90],GB:[-0.13,51.51],IE:[-6.26,53.35],AT:[16.37,48.21],CH:[7.45,46.95],DK:[12.57,55.68],NO:[10.75,59.91],
 SE:[18.07,59.33],FI:[24.94,60.17],PL:[21.01,52.23],CZ:[14.44,50.08],GR:[23.73,37.98],HU:[19.04,47.50],HR:[15.98,45.81],
 IS:[-21.94,64.15],EE:[24.75,59.44],LV:[24.11,56.95],LT:[25.28,54.69],SK:[17.11,48.15],SI:[14.51,46.06],BA:[18.41,43.86],
 RS:[20.46,44.82],ME:[19.26,42.44],XK:[21.17,42.66],AL:[19.82,41.33],MK:[21.43,42.00],BG:[23.32,42.70],RO:[26.10,44.43],
 MD:[28.86,47.01],UA:[30.52,50.45],BY:[27.57,53.90],RU:[37.62,55.75],TR:[32.85,39.93],CY:[33.37,35.17],MT:[14.51,35.90],
 AD:[1.52,42.51],MC:[7.42,43.73],LI:[9.52,47.14],SM:[12.45,43.94],VA:[12.45,41.90],
 CN:[116.40,39.90],JP:[139.69,35.69],IN:[77.21,28.61],ID:[106.85,-6.21],TH:[100.50,13.75],VN:[105.85,21.03],
 KR:[126.98,37.57],SA:[46.72,24.69],PK:[73.06,33.69],PH:[120.98,14.60],MY:[101.69,3.14],IR:[51.39,35.69],
 IQ:[44.37,33.31],AF:[69.17,34.53],MN:[106.92,47.92],NP:[85.32,27.72],BD:[90.41,23.81],LK:[79.86,6.93],
 KP:[125.75,39.03],TW:[121.56,25.03],MM:[96.13,19.75],KH:[104.92,11.56],LA:[102.63,17.97],BT:[89.64,27.47],
 KZ:[71.43,51.13],UZ:[69.24,41.31],TM:[58.38,37.95],KG:[74.59,42.87],TJ:[68.77,38.56],IL:[35.21,31.77],
 JO:[35.93,31.95],LB:[35.50,33.89],SY:[36.29,33.51],YE:[44.21,15.35],OM:[58.54,23.61],AE:[54.37,24.45],
 QA:[51.53,25.29],KW:[47.98,29.38],GE:[44.79,41.72],AM:[44.51,40.18],AZ:[49.87,40.41],TL:[125.57,-8.56],
 SG:[103.85,1.29],BH:[50.59,26.23],MV:[73.51,4.17],BN:[114.94,4.94]
};
for(const l of WERELD)if(KAP[l.id]&&!STEDEN[l.id])STEDEN[l.id]=KAP[l.id];
const ontbreekt=WERELD.filter(l=>!STEDEN[l.id]).map(l=>l.id);
if(ontbreekt.length)console.error("GEEN hoofdstad-coördinaat voor:",ontbreekt.join(","));
// meren als waterlaag op de globe (grotere meren; fijn afgerond voor diep zoomen)
const MEREN=JSON.parse(readFileSync("meren.geojson","utf8"));
const meren=[]; // per meer: [buitenring, ...gaten] — gaten (bv. Flevoland) blijven land dankzij evenodd
for(const f of MEREN.features){
  const polys=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
  for(const poly of polys){
    const ring=poly[0]; if(!ring||ring.length<4)continue;
    if(area(ring)<0.02)continue;
    const s2=simplify(ring,0.01); if(s2.length<3)continue;
    const pg=[round3(s2)];
    for(const gat of poly.slice(1)){
      if(!gat||gat.length<4||area(gat)<0.004)continue;
      const g2=simplify(gat,0.01); if(g2.length>=3)pg.push(round3(g2));
    }
    meren.push(pg);
  }
}
console.log(`meren: ${meren.length} meren, ${meren.flat().reduce((a,r)=>a+r.length,0)} punten, ${meren.filter(p=>p.length>1).length} met gaten`);
const GLOBE={cont:CONT, landen, dots, rest, steden:STEDEN, meren};
const tel=Object.keys(landen).length;
const punten=Object.values(landen).flat().reduce((a,r)=>a+r.length,0)+rest.reduce((a,r)=>a+r.length,0);
console.log(`speelbaar: ${tel} landen + ${Object.keys(dots).length} stippen, rest: ${rest.length} ringen, punten totaal: ${punten}`);

// datapacks schrijven (daarna: node maak-manifest.mjs)
writeFileSync("data/core/globe.json",JSON.stringify(GLOBE));
writeFileSync("data/core/globe-fijn.json",JSON.stringify(landenFijn));
writeFileSync("data/core/globe-max.json",JSON.stringify(landenMax));
const puntenF=Object.values(landenFijn).flat().reduce((a,r)=>a+r.length,0);
const puntenM=Object.values(landenMax).flat().reduce((a,r)=>a+r.length,0);
console.log(`fijn: ${puntenF} punten | max: ${puntenM} punten`);
console.log("packs geschreven: data/core/globe.json + globe-fijn.json — vergeet 'node maak-manifest.mjs' niet");
