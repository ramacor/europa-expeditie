// Genereert ruwe lon/lat-geometrie voor de 3D-globe: speelbare landen (EU+AS) apart,
// de rest van de wereld als neutrale landmassa. Injecteert GLOBE in index/europa-expeditie.html.
import { readFileSync, writeFileSync } from "node:fs";
const SRC="ne50m.geojson";
const HTML="index.html";

const EU=["IS","IE","GB","PT","ES","FR","NL","BE","LU","DE","DK","NO","SE","FI","PL","CZ","AT","CH","IT","GR","HU","HR","SI","SK","EE","LV","LT","BA","RS","ME","XK","AL","MK","BG","RO","MD","UA","BY","RU","TR","CY","MT","AD","MC","LI","SM","VA"];
const AS=["CN","JP","IN","ID","TH","VN","KR","SA","PK","PH","MY","IR","IQ","AF","MN","NP","BD","LK","KP","TW","MM","KH","LA","BT","KZ","UZ","TM","KG","TJ","IL","JO","LB","SY","YE","OM","AE","QA","KW","GE","AM","AZ","TL","SG","BH","MV","BN"];
const PLAY=new Set([...EU,...AS]);
const CONT={}; EU.forEach(c=>CONT[c]="EU"); AS.forEach(c=>CONT[c]="AS");
const NAAM2CODE={ "Northern Cyprus":"CY", "Taiwan":"TW" };
// hoofdstad-coords voor landen die te klein zijn voor een polygoon (stip op de globe)
const DOTS={ AD:[1.52,42.51], MC:[7.42,43.73], LI:[9.52,47.14], SM:[12.45,43.94], VA:[12.45,41.90], MT:[14.51,35.90],
             SG:[103.82,1.29], BH:[50.58,26.22], MV:[73.51,4.17] };

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
const round=ring=>ring.map(([lo,la])=>[r1(lo),r1(la)]);

const gj=JSON.parse(readFileSync(SRC,"utf8"));
const landen={}, rest=[];
for(const f of gj.features){
  const p=f.properties;
  let code=p.ISO_A2&&p.ISO_A2!=="-99"?p.ISO_A2:(p.ISO_A2_EH&&p.ISO_A2_EH!=="-99"?p.ISO_A2_EH:null);
  if(NAAM2CODE[p.ADMIN])code=NAAM2CODE[p.ADMIN];
  const speel=code&&PLAY.has(code);
  const polys=f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates;
  for(const poly of polys){
    let ring=poly[0];
    if(!ring||ring.length<4)continue;
    const A=area(ring);
    if(A < (speel?0.02:0.6))continue;           // te kleine stukjes weglaten
    const simp=simplify(ring, speel?0.35:1.1);
    if(simp.length<3)continue;
    if(speel){(landen[code] ||= []).push(round(simp));}
    else rest.push(round(simp));
  }
}
// stippen voor mini-landen zonder (bewaarde) polygoon
const dots={};
for(const code in DOTS){ if(!landen[code]) dots[code]=DOTS[code]; }

const GLOBE={cont:CONT, landen, dots, rest};
const tel=Object.keys(landen).length;
const punten=Object.values(landen).flat().reduce((a,r)=>a+r.length,0)+rest.reduce((a,r)=>a+r.length,0);
console.log(`speelbaar: ${tel} landen + ${Object.keys(dots).length} stippen, rest: ${rest.length} ringen, punten totaal: ${punten}`);

let html=readFileSync(HTML,"utf8");
const blok=`<script id="globedata">
// Ruwe lon/lat-geometrie voor de 3D-globe (Natural Earth 50m, vereenvoudigd).
const GLOBE=${JSON.stringify(GLOBE)};
</${"script"}>`;
if(html.includes('<script id="globedata">')) html=html.replace(/<script id="globedata">[\s\S]*?<\/script>/,blok);
else html=html.replace('<script id="geodata">', blok+'\n<script id="geodata">');
writeFileSync(HTML,html);
console.log("HTML bijgewerkt:",html.length,"tekens");
