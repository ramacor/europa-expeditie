// Europa Expeditie — offline spelen. Netwerk eerst (altijd de nieuwste versie),
// cache als terugval zonder internet. Verhoog het app-versienummer (CACHE) bij een update.
const CACHE = "europa-expeditie-v48";   // app-schil (klein) — wordt bij elke update opnieuw geladen
const MEDIA = "europa-media-v3";        // geluid + muziek — blijft staan bij app-updates (v3: stemclips z20-z30 vervangen + z31-z50 nieuw)
const DATA  = "europa-data-v1";         // datapacks (kaarten/globe/content) — blijft staan; netwerk-eerst houdt ze vers
const APP = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-512.png"];
const STEM = Array.from({ length: 50 }, (_, i) => `./stem/z${String(i + 1).padStart(2, "0")}.mp3`);
const MUZIEK = ["./muziek/menu.mp3", "./muziek/spel.mp3", "./muziek/wereldreis.mp3", "./muziek/avontuur2.mp3"];
const MEDIA_FILES = [...STEM, ...MUZIEK];
const abs = u => new URL(u, self.location.href).href;
const isMedia = url => /\.(mp3|m4a|ogg|wav)$/i.test(new URL(url).pathname);
const isData = url => new URL(url).pathname.includes("/data/");

// packlijst uit het manifest (best-effort; bij falen vangt de fetch-handler het later op)
async function dataBestanden() {
  try {
    const mf = await (await fetch("./data/manifest.json", { cache: "no-cache" })).json();
    return ["./data/manifest.json", "./data/licenses.json", ...Object.keys(mf.packs).map(p => "./data/" + p)];
  } catch (e) { return []; }
}

self.addEventListener("install", e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => c.addAll(APP)),
    // media/data alléén ophalen als ze nog niet gecachet zijn → geen her-download bij elke update
    caches.open(MEDIA).then(c =>
      Promise.allSettled(MEDIA_FILES.map(async u => { if (!(await c.match(u))) await c.add(u); }))
    ),
    dataBestanden().then(files => caches.open(DATA).then(c =>
      Promise.allSettled(files.map(async u => { if (!(await c.match(u))) await c.add(u); }))
    ))
  ]).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE && k !== MEDIA && k !== DATA).map(k => caches.delete(k)));
    // verouderde bestanden opruimen (verwijderde muziek/packs)
    try {
      const wantedM = new Set(MEDIA_FILES.map(abs));
      const mc = await caches.open(MEDIA);
      for (const req of await mc.keys()) if (!wantedM.has(req.url)) await mc.delete(req);
      const files = await dataBestanden();
      if (files.length) {
        const wantedD = new Set(files.map(abs));
        const dc = await caches.open(DATA);
        for (const req of await dc.keys()) if (!wantedD.has(req.url)) await dc.delete(req);
      }
    } catch (e) {}
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const doel = isMedia(e.request.url) ? MEDIA : isData(e.request.url) ? DATA : CACHE;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const kopie = res.clone();
        caches.open(doel).then(c => c.put(e.request, kopie)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then(r => r || caches.match("./index.html"))
      )
  );
});
