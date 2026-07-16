# Finn's Expeditie (Europa-topografiespel) 🌍💎

Leerspel voor de topografie van Europa: klik landen aan op een echte kaart (Natural Earth-grenzen) of beantwoord meerkeuzevragen over landen en hoofdsteden. Verdien punten en diamanten, verzamel paspoortstempels en word de Legende van Europa.

## Spelen

- **Live (iPad, telefoon, computer):** zie de URL in de repo-beschrijving zodra GitHub Pages actief is.
- Op de iPad: open de link in Safari → deelknop → **"Zet op beginscherm"**. Het spel werkt daarna fullscreen als app, ook offline.
- Privé-preview (artifact): https://claude.ai/code/artifact/a5e1810c-7369-4ba3-b737-3b0ce2e029b9

## Bestanden

| Bestand | Wat |
|---|---|
| `index.html` | De app-schil (vanilla JS); laadt de datapacks uit `data/` |
| `data/` | Datapacks: kaarten per continent, globe-geometrie, content, `manifest.json` (hash per pack), `licenses.json` |
| `sw.js` | Service worker: offline spelen; app-schil versioned, media (`stem/`, `muziek/`) en datapacks in eigen persistente caches |
| `stem/` + `muziek/` | Gesproken aanmoedigingen en achtergrondmuziek |
| `manifest.webmanifest` + `icon-*.png` | Beginscherm-app op iPad/Android |
| `build-kaart.mjs` / `build-globe.mjs` / `bouw-inhoud.mjs` | Genereren de datapacks opnieuw uit de bronnen |
| `maak-manifest.mjs` | Herbouwt `data/manifest.json` na elke pack-wijziging |
| `maak-artifact.mjs` | Bouwt `artifact.html`: single-file variant voor de Claude-artifact-preview |

## Release

```
# wijzig index.html, verhoog daarin VERSIE én CACHE in sw.js (zelfde nummer)
# bij gewijzigde datapacks: node maak-manifest.mjs
node maak-artifact.mjs   # ververs de single-file preview-variant
git add -A && git commit -m "..." && git push
```

GitHub Pages werkt de site binnen ± een minuut bij. De beginscherm-app op de iPad hoeft **nooit** opnieuw aangemaakt te worden: bij een verse start met internet laadt hij automatisch de nieuwste versie, en een app die nog open stond toont vanzelf een "🔄 nieuwe versie"-knop (via de VERSIE-check). Media en datapacks worden alléén gedownload als ze ontbreken of gewijzigd zijn — updates blijven dus klein.

## Kaartdata vernieuwen

```
curl -sL -o ne10m.geojson "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson"
node build-kaart.mjs     # platte kaarten per continent → data/continents/
node build-globe.mjs     # 3D-globe-geometrie → data/core/globe.json
node maak-manifest.mjs   # manifest bijwerken
node maak-artifact.mjs   # preview-variant bijwerken
```

Kaartgrenzen: [Natural Earth](https://www.naturalearthdata.com/) 1:10m — hoogste resolutie (publiek domein), Lambert azimuthal equal-area (52°N 10°E), vereenvoudigd met Douglas-Peucker.

## Privacy

Spelersnamen en voortgang staan alléén in localStorage op het apparaat zelf. Er is geen server, geen account en er wordt niets verstuurd.

## Credits

- Kaartgrenzen: [Natural Earth](https://www.naturalearthdata.com/) (publiek domein)
- Foto's: Wikimedia Commons via Wikipedia (vrije licenties, bronlink bij elke foto in het spel)
- Scheetgeluid: ["Human fart.wav"](https://commons.wikimedia.org/wiki/File:Human_fart.wav), Wikimedia Commons, CC BY-SA 4.0
