# خريطة اليمن · Yemen Map

An Arabic-first interactive explorer of Yemen's 22 governorates and 335 districts, built with MapLibre GL JS and Vite. Fully static: no server, no database.

## Features (version 1)

- Map of the 22 governorates. Hover highlights one, click zooms to it and opens the side panel.
- Side panel with Arabic and English names, capital, population, area, density and the district list.
- Drill down: a selected governorate shows its districts; click a district for its details.
- Search in Arabic or English: "تعز", "Taiz" and "Ta'iz" all find the same place. Press `/` to focus it.
- RTL Arabic interface with an English toggle (remembered per browser).
- Phone layout with a bottom sheet.

## Run locally

```sh
npm install
npm run dev
```

`npm run build` writes the static site to `dist/`.

## Data

Everything the app reads lives in `public/data/` and is committed, so a normal build does not need to download anything.

| File | Contents |
| --- | --- |
| `yemen.json` | All governorate and district attributes: names, capital, population, area, bounds |
| `governorates.geojson`, `districts.geojson` | Simplified boundaries (about 120 KB and 330 KB, down from 2.8 MB and 5.9 MB) |
| `*-labels.geojson` | Label points |

To rebuild it from the sources:

```sh
npm run data
```

This downloads the raw files into `data-raw/` (git-ignored), simplifies the boundaries with mapshaper (8% of vertices kept, see `SIMPLIFY` in `scripts/build-data.mjs`) and joins the population table. Capitals, corrected Arabic spellings and search aliases for governorates are in `scripts/governorates-meta.json`. The script needs `unzip` on the path.

Sources:

- Boundaries: [OCHA COD-AB Yemen](https://data.humdata.org/dataset/cod-ab-yem) (CSO, valid 2019-11-22), CC BY-IGO.
- Population: [Yemen Population Taskforce 2025 estimates](https://data.humdata.org/dataset/yemen-population-estimates) (CSO, UNFPA, IOM, OCHA), CC BY. Governorate totals are the sum of their districts. Two "Sana'a City Outskirts" districts have no figure in the source and show "No data".

District Arabic names come from the source as published, so some use ه in place of ة.

## Base map (optional)

Without configuration the map draws only the boundaries on a plain background. To add a Protomaps base map, extract Yemen from a Protomaps daily build and host the file (for example on Cloudflare R2, with CORS allowing your site):

```sh
pmtiles extract https://build.protomaps.com/20260901.pmtiles yemen.pmtiles --bbox=41.5,11.8,54.8,19.2
```

Then set the URL at build time:

```sh
VITE_PMTILES_URL=https://your-bucket.example.com/yemen.pmtiles npm run build
```

Map label fonts and base map sprites load from `protomaps.github.io/basemaps-assets`.

## Deploy

Any static host works. Build command `npm run build`, output directory `dist`.

- **Vercel**: import the repo; the Vite preset is detected automatically.
- **Cloudflare Pages**: framework preset "Vite", same command and output.

Add `VITE_PMTILES_URL` as an environment variable in the host's settings if you use a base map.

## Roadmap

- Version 2: 3D terrain, layer switcher (heritage sites, cities, ports and airports, roads), choropleth by population, area or density, shareable links such as `?gov=hadramawt`.
- Version 3: heritage photo cards, offline/PWA support.
