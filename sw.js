// Europa Expeditie — offline spelen. Netwerk eerst (altijd de nieuwste versie),
// cache als terugval zonder internet. Verhoog het app-versienummer (CACHE) bij een update.
const CACHE = "europa-expeditie-v34";   // app-schil (klein) — wordt bij elke update opnieuw geladen
const MEDIA = "europa-media-v2";        // geluid + muziek — blijft staan bij app-updates
const APP = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-512.png"];
const STEM = Array.from({ length: 30 }, (_, i) => `./stem/z${String(i + 1).padStart(2, "0")}.mp3`);
const MUZIEK = ["./muziek/menu.mp3", "./muziek/spel.mp3", "./muziek/wereldreis.mp3", "./muziek/avontuur2.mp3"];
const MEDIA_FILES = [...STEM, ...MUZIEK];
const abs = u => new URL(u, self.location.href).href;
const isMedia = url => /\.(mp3|m4a|ogg|wav)$/i.test(new URL(url).pathname);

self.addEventListener("install", e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => c.addAll(APP)),
    // media alléén ophalen als het nog niet gecachet is → geen her-download van de ~16 MB bij elke update
    caches.open(MEDIA).then(c =>
      Promise.allSettled(MEDIA_FILES.map(async u => { if (!(await c.match(u))) await c.add(u); }))
    )
  ]).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE && k !== MEDIA).map(k => caches.delete(k)));
    // verouderde mediabestanden opruimen (bv. verwijderde muziek)
    const wanted = new Set(MEDIA_FILES.map(abs));
    const mc = await caches.open(MEDIA);
    for (const req of await mc.keys()) if (!wanted.has(req.url)) await mc.delete(req);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const naarMedia = isMedia(e.request.url);
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const kopie = res.clone();
        caches.open(naarMedia ? MEDIA : CACHE).then(c => c.put(e.request, kopie)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then(r => r || caches.match("./index.html"))
      )
  );
});
