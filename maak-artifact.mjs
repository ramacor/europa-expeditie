// Bouwt artifact.html: de single-file variant van het spel voor de Claude-artifact-preview.
// Daar kunnen geen losse databestanden geladen worden, dus bakken we de packs weer in.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const pak = p => readFileSync("data/" + p, "utf8");

const INLINE = `<script id="dataloader">
// Artifact-variant: alle datapacks ingebakken (de artifact-preview kan geen losse bestanden laden).
const KAARTEN={EU:${pak("continents/europa.json")},AS:${pak("continents/azie.json")},AF:${pak("continents/afrika.json")},NA:${pak("continents/noord-amerika.json")},SA:${pak("continents/zuid-amerika.json")},OC:${pak("continents/oceanie.json")}};
const GLOBE=${pak("core/globe.json")};
let EXTRA=Object.assign({},${pak("content/nl/europa.json")},${pak("content/nl/azie.json")});
const FIJN_INLINE={EU:${pak("continents/europa-fijn.json")},AS:${pak("continents/azie-fijn.json")},AF:${pak("continents/afrika-fijn.json")},NA:${pak("continents/noord-amerika-fijn.json")},SA:${pak("continents/zuid-amerika-fijn.json")},OC:${pak("continents/oceanie-fijn.json")}};
const GLOBE_FIJN_INLINE=${pak("core/globe-fijn.json")};
const RIVIEREN_INLINE=${pak("core/rivieren.json")};
const HOOGTE_INLINE=${pak("core/hoogte.json")};
const LANDMODUS_INLINE=${pak("landen/nederland.json")};
const ARTIFACT_DEMO=true; // preview: toon voorbeeldstempels in het paspoort om het ontwerp te beoordelen
const DATA_KLAAR=Promise.resolve();
</${"script"}>
`;
const uit = html.replace(/<script id="dataloader">[\s\S]*?<\/script>\n?/, INLINE);
if (uit === html) throw new Error("dataloader-blok niet gevonden in index.html");
writeFileSync("artifact.html", uit);
console.log(`artifact.html: ${Math.round(uit.length / 1024)} KB (single-file, voor de artifact-preview)`);
