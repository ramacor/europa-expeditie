// Injecteert de wereld-landen (bron-wereld.mjs) in de LANDEN-array van index.html.
// Idempotent: landen die er al staan worden overgeslagen. Vlag-emoji wordt uit de ISO-code afgeleid.
import { readFileSync, writeFileSync } from "node:fs";
import { WERELD } from "./bron-wereld.mjs";

const HTML = "index.html";
const vlag = id => [...id.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join("");
const js = s => JSON.stringify(s); // nette escaping van aanhalingstekens

let html = readFileSync(HTML, "utf8");
const start = html.indexOf("const LANDEN=[");
const eind = html.indexOf("\n];", start);
if (start < 0 || eind < 0) throw new Error("LANDEN-array niet gevonden");
const bestaand = new Set([...html.slice(start, eind).matchAll(/\{id:"([A-Z]{2})"/g)].map(m => m[1]));

const nieuwe = WERELD.filter(l => !bestaand.has(l.id));
const regels = nieuwe.map(l =>
  ` {id:${js(l.id)},n:${js(l.n)},h:${js(l.h)},f:${js(vlag(l.id))},cont:${js(l.cont)},lvl:${l.lvl},card:${js(l.card)},hint:${js(l.hint)},fact:${js(l.fact)},w:${js(l.w)}},`
).join("\n");

if (nieuwe.length) {
  // zorg dat de laatste bestaande entry een komma heeft
  let j = eind - 1; while (" \t\r\n".includes(html[j])) j--;
  if (html[j] !== ",") html = html.slice(0, j + 1) + "," + html.slice(j + 1);
  html = html.slice(0, html.indexOf("\n];", start)) + "\n /* ---- wereld (fase 2): gegenereerd uit bron-wereld.mjs ---- */\n" + regels + html.slice(html.indexOf("\n];", start));
  writeFileSync(HTML, html);
}
console.log(`LANDEN: ${bestaand.size} bestaand, ${nieuwe.length} toegevoegd → ${bestaand.size + nieuwe.length} totaal`);
