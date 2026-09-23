# خريطة اليمن · Yemen Map

An Arabic-first interactive explorer of Yemen's 22 governorates and 335 districts, built with MapLibre GL JS and Vite, plus the Ghurba map (خريطة الغربة) of Yemenis abroad. It runs on Cloudflare Workers: the site is static files, and a small Worker with a D1 database serves the Ghurba map.

## Features

- Map of the 22 governorates. Hover highlights one, click zooms to it and opens the side panel.
- Side panel with Arabic and English names, capital, population, area, density and the district list.
- Drill down: a selected governorate shows its districts; click a district for its details.
- Search in Arabic or English: "تعز", "Taiz" and "Ta'iz" all find the same place. Press `/` to focus it.
- RTL Arabic interface with an English toggle (remembered per browser).
- Phone layout with a bottom sheet.

### Ghurba map

The "الغربة" switch (or `?view=ghurba`) turns the map into a slowly spinning globe. Each Yemeni abroad draws one line, from their district to the city they live in. The spec is in [`ghurba-map.md`](ghurba-map.md).

- Counter: "12,430 Yemenis in 87 countries and 540 cities", with correct Arabic number agreement.
- Draw your line: governorate and district, then a city search (about 900 cities, Arabic or English, also by country name), an optional message, and a Turnstile check.
- The moment: the camera flies to the new line and draws it, with "أنت واحد من 214 من حجة في الرياض".
- Share card: a square image drawn in the browser, with WhatsApp, story (Web Share, on phones) and download buttons.
- Explore: click a governorate ("where are the people of Taiz?") or a city ("where are Jeddah's Yemenis from?"). Links such as `?view=ghurba&gov=taiz` or `&city=105343` open that view.
- Messages appear only after review on `/admin.html`.
- Weak devices and reduced-motion settings get a still globe without the glow.

Privacy:

- No names, emails, accounts or browser geolocation. Only the district and the city are stored, and the city is its center point.
- The browser only receives counts per district and city. Numbers under 3 are not shown (the line still is).
- The IP address is never stored. A keyed hash of IP and browser allows one line per device per day; a daily cron clears it after 30 days. Worker request logs are off.
- Approved messages show the governorate, not the district. A rejected message is deleted.

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars   # local secrets; Turnstile uses Cloudflare's always-pass test keys
npm run db:migrate:local         # creates the local D1 database in .wrangler/
npm run dev
```

`npm run dev` runs the site and the Worker (`worker/index.js`) together through the Cloudflare Vite plugin, with a local D1 database. `npm run build` writes the site to `dist/client` and the Worker to `dist/yemen_map`.

## Data

Everything the app reads lives in `public/data/` and is committed, so a normal build does not need to download anything.

| File | Contents |
| --- | --- |
| `yemen.json` | All governorate and district attributes: names, capital, population, area, bounds |
| `governorates.geojson`, `districts.geojson` | Simplified boundaries (about 120 KB and 330 KB, down from 2.8 MB and 5.9 MB) |
| `*-labels.geojson` | Label points |
| `cities.json` | Ghurba destination cities: Arabic and English names, country, center, search aliases |
| `land.geojson` | World land for the globe and the share card (about 240 KB) |

To rebuild it from the sources:

```sh
npm run data
```

This downloads the raw files into `data-raw/` (git-ignored), simplifies the boundaries with mapshaper (8% of vertices kept, see `SIMPLIFY` in `scripts/build-data.mjs`) and joins the population table. Capitals, corrected Arabic spellings and search aliases for governorates are in `scripts/governorates-meta.json`. The script needs `unzip` on the path.

Sources:

- Boundaries: [OCHA COD-AB Yemen](https://data.humdata.org/dataset/cod-ab-yem) (CSO, valid 2019-11-22), CC BY-IGO.
- Population: [Yemen Population Taskforce 2025 estimates](https://data.humdata.org/dataset/yemen-population-estimates) (CSO, UNFPA, IOM, OCHA), CC BY. Governorate totals are the sum of their districts. Two "Sana'a City Outskirts" districts have no figure in the source and show "No data".

District Arabic names come from the source as published, so some use ه in place of ة.

The Ghurba files have their own script:

```sh
npm run data:ghurba
```

It downloads about 210 MB into `data-raw/` and picks about 900 cities: every capital, every Saudi city in the list, lower population cut-offs where most Yemenis abroad live (Gulf, Arab world, Horn of Africa, Malaysia, Turkey, UK, US), and known communities such as Dearborn, Hamtramck, Lackawanna and South Shields. Neighborhoods and boroughs are merged into their city as search aliases ("Brooklyn" finds New York). Yemen is left out (displacement inside Yemen is a separate topic), and so is Israel. Arabic names GeoNames lacks or gets wrong are fixed in `NAME_FIX`. All of this is at the top of `scripts/build-ghurba-data.mjs`.

- Cities: [GeoNames](https://www.geonames.org) `cities15000` and alternate names, CC BY 4.0.
- Land: [Natural Earth](https://www.naturalearthdata.com) 1:50m land, public domain.

## Base map

The base map is two [Protomaps](https://protomaps.com) PMTiles files cut from OpenStreetMap:

| File | Area | Zooms | Size |
| --- | --- | --- | --- |
| `region.pmtiles` | Wide box around Yemen (the map's pan limit) | 0 to 6 | about 5 MB |
| `yemen.pmtiles` | Yemen plus a margin | 0 to 13 | about 60 MB |

The zoomed-out views use the region file and the Yemen file takes over from zoom 6. The browser fetches only the tiles on screen, through HTTP range requests, so visitors never download the whole file.

`.github/workflows/basemap.yml` builds both files from the latest Protomaps daily planet build every Monday (or on demand from the Actions tab) and publishes them to this repo's GitHub Pages site. `.env` points the app there through `VITE_BASEMAP_URL`. If the files can't be reached, the map loads without a base map.

One-time setup: the repo must be public (GitHub Pages needs a paid plan for private repos), and under Settings > Pages the source must be "GitHub Actions".

To build the files by hand, install the [pmtiles CLI](https://github.com/protomaps/go-pmtiles) and run the two `extract` commands from the workflow.

Map label fonts and base map sprites load from `protomaps.github.io/basemaps-assets`.

## Fonts

The interface uses Thmanyah Sans from [`@dawod/thmanyah-font-web`](https://www.npmjs.com/package/@dawod/thmanyah-font-web). Font files stream from jsDelivr, and the browser fetches only the weights the page uses (400 and 700), with a fallback font shown until they arrive. The [Thmanyah license](https://font.thmanyah.com/licenses) allows personal use; commercial use needs permission from Thmanyah.

## Deploy

The site runs as the `yemen-map` Worker on Cloudflare (Workers with static assets; Vercel cannot host the D1 database). Workers Builds deploys every push to `main`: build command `npm run build`, deploy command `npx wrangler deploy`. `wrangler.jsonc` holds the configuration.

| Piece | Where |
| --- | --- |
| Site | `https://yemen-map.dawod.workers.dev` |
| Database | D1 `ghurba`, schema in `migrations/` |
| Turnstile | Widget "Ghurba Map (yemen-map)"; its site key is in `.env` |
| Secrets | `TURNSTILE_SECRET`, `HASH_SALT`, `ADMIN_TOKEN` |

`TURNSTILE_SECRET` and `HASH_SALT` are already set on the Worker. Set the admin password yourself, since nobody else should know it:

```sh
npx wrangler secret put ADMIN_TOKEN
```

After adding a migration, apply it with `npm run db:migrate` (Workers Builds does not run migrations). A custom domain must also be added to the Turnstile widget's hostnames.

Costs: D1's free plan allows 5 million rows read a day. The public counts are cached for a minute, but each refresh reads every line, so move to the Workers Paid plan ($5 a month) before the public launch.

### Moderation

Open `/admin.html` and enter `ADMIN_TOKEN`. Pending messages can be published or rejected, and any line can be hidden or shown again.

## Roadmap

- Yemen map: 3D terrain, layer switcher (heritage sites, cities, ports and airports, roads), choropleth by population, area or density, shareable links such as `?gov=hadramawt`; later heritage photo cards and offline/PWA support.
- Ghurba map: lines for people displaced inside Yemen (a separate topic, deliberately left out).
