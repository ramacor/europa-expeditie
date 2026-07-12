# Europa Expeditie 🌍💎

Leerspel voor de topografie van Europa: klik landen aan op een echte kaart (Natural Earth-grenzen) of beantwoord meerkeuzevragen over landen en hoofdsteden. Verdien punten en diamanten, verzamel paspoortstempels en word de Legende van Europa.

## Spelen

- **Live (iPad, telefoon, computer):** zie de URL in de repo-beschrijving zodra GitHub Pages actief is.
- Op de iPad: open de link in Safari → deelknop → **"Zet op beginscherm"**. Het spel werkt daarna fullscreen als app, ook offline.
- Privé-preview (artifact): https://claude.ai/code/artifact/a5e1810c-7369-4ba3-b737-3b0ce2e029b9

## Bestanden

| Bestand | Wat |
|---|---|
| `index.html` | Het complete spel (single file, vanilla JS) |
| `sw.js` | Service worker: offline spelen; **verhoog het versienummer bij elke update** |
| `manifest.webmanifest` + `icon-*.png` | Beginscherm-app op iPad/Android |
| `build-kaart.mjs` | Genereert de kaartdata opnieuw uit Natural Earth 50m |

## Release

```
# wijzig index.html (en bump CACHE in sw.js), daarna:
git add -A && git commit -m "..." && git push
```

GitHub Pages werkt de site binnen ± een minuut bij. iPads met de app op het beginscherm halen de nieuwe versie bij de eerstvolgende start met internet.

## Kaartdata vernieuwen

```
curl -sL -o ne50m.geojson "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson"
node build-kaart.mjs   # schrijft de nieuwe kaartdata in index.html
```

Kaartgrenzen: [Natural Earth](https://www.naturalearthdata.com/) 50m (publiek domein), Lambert azimuthal equal-area (52°N 10°E), vereenvoudigd met Douglas-Peucker.

## Privacy

Spelersnamen en voortgang staan alléén in localStorage op het apparaat zelf. Er is geen server, geen account en er wordt niets verstuurd.
