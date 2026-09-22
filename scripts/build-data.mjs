// Builds the static map data in public/data from OCHA HDX sources.
//   npm run data
// Raw downloads are cached in data-raw/ (git-ignored).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'data-raw');
const out = join(root, 'public', 'data');

const SOURCES = {
  // OCHA COD-AB Yemen administrative boundaries (valid 2019-11-22)
  boundaries:
    'https://data.humdata.org/dataset/6b2656e2-b915-4671-bfed-468d5edcd80a/resource/c79a3728-44cd-4d20-8ea4-ecfab88c1450/download/yem_admin_boundaries.geojson.zip',
  // Yemen Population Taskforce (CSO, UNFPA, IOM, OCHA) 2025 district estimates
  population:
    'https://data.humdata.org/dataset/1ffe81f1-b980-430f-b53e-dd79e936f291/resource/f7443827-7945-410b-8f72-1eb4e46b8525/download/yem_population_projection_2025_final_hxl.csv',
};

// Share of vertices kept by mapshaper. Raw files are ~3 MB and ~6 MB.
const SIMPLIFY = '8%';

async function download(url, file) {
  if (existsSync(file)) return;
  console.log('downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function parsePopulation(csv) {
  const rows = csv.replace(/^﻿/, '').trim().split(/\r?\n/).slice(2); // header + HXL row
  const pop = {};
  for (const row of rows) {
    const c = row.split(',').map((s) => s.trim());
    pop[c[3]] = { population: Number(c[6]) || null, idps: Number(c[5]) || 0 };
  }
  return pop;
}

function bbox(geometry) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys)
    for (const [x, y] of poly[0]) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  return [w, s, e, n].map((v) => +v.toFixed(4));
}

const round = (v, d = 0) => +v.toFixed(d);

async function main() {
  mkdirSync(raw, { recursive: true });
  mkdirSync(out, { recursive: true });

  const zip = join(raw, 'boundaries.zip');
  const csv = join(raw, 'population.csv');
  await download(SOURCES.boundaries, zip);
  await download(SOURCES.population, csv);
  if (!existsSync(join(raw, 'yem_admin1.geojson'))) execFileSync('unzip', ['-o', zip, '-d', raw]);

  const tmp = join(raw, 'simplified');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  await mapshaper.runCommands(
    `-i "${join(raw, 'yem_admin1.geojson')}" -simplify ${SIMPLIFY} weighted keep-shapes ` +
      `-o "${join(tmp, 'adm1.json')}" precision=0.0001`,
  );
  await mapshaper.runCommands(
    `-i "${join(raw, 'yem_admin2.geojson')}" -simplify ${SIMPLIFY} weighted keep-shapes ` +
      `-o "${join(tmp, 'adm2.json')}" precision=0.0001`,
  );

  const meta = JSON.parse(readFileSync(join(root, 'scripts', 'governorates-meta.json'), 'utf8'));
  const pop = parsePopulation(readFileSync(csv, 'utf8'));
  const adm1 = JSON.parse(readFileSync(join(tmp, 'adm1.json'), 'utf8'));
  const adm2 = JSON.parse(readFileSync(join(tmp, 'adm2.json'), 'utf8'));

  const governorates = {};
  const districts = {};

  for (const f of adm1.features) {
    const p = f.properties;
    const m = meta[p.adm1_pcode];
    if (!m) throw new Error(`missing metadata for ${p.adm1_pcode}`);
    governorates[p.adm1_pcode] = {
      id: p.adm1_pcode,
      slug: m.slug,
      name: { ar: m.ar, en: m.en },
      aliases: [p.adm1_name, p.adm1_name1, ...(m.aliases || [])],
      capital: m.capital,
      area: round(p.area_sqkm),
      population: 0,
      center: [round(p.center_lon, 4), round(p.center_lat, 4)],
      bbox: bbox(f.geometry),
      districts: [],
    };
    f.properties = { id: p.adm1_pcode, ar: m.ar, en: m.en };
  }

  for (const f of adm2.features) {
    const p = f.properties;
    const gov = governorates[p.adm1_pcode];
    const d = pop[p.adm2_pcode];
    if (!d) console.warn('no population for', p.adm2_pcode, p.adm2_name);
    districts[p.adm2_pcode] = {
      id: p.adm2_pcode,
      gov: p.adm1_pcode,
      name: { ar: p.adm2_name1, en: p.adm2_name },
      area: round(p.area_sqkm, 1),
      population: d?.population ?? null,
      idps: d?.idps ?? null,
      center: [round(p.center_lon, 4), round(p.center_lat, 4)],
      bbox: bbox(f.geometry),
    };
    gov.districts.push(p.adm2_pcode);
    gov.population += d?.population ?? 0;
    f.properties = { id: p.adm2_pcode, gov: p.adm1_pcode, ar: p.adm2_name1, en: p.adm2_name };
  }

  // Label points at the COD-AB centroids, which sit inside the polygon.
  const points = (items) => ({
    type: 'FeatureCollection',
    features: Object.values(items).map((i) => ({
      type: 'Feature',
      properties: { id: i.id, gov: i.gov, ar: i.name.ar, en: i.name.en },
      geometry: { type: 'Point', coordinates: i.center },
    })),
  });

  const data = {
    sources: {
      boundaries: 'OCHA COD-AB Yemen, HDX (2019-11-22)',
      population: 'Yemen Population Taskforce 2025 estimates (CSO, UNFPA, IOM, OCHA), HDX',
    },
    governorates,
    districts,
  };

  writeFileSync(join(out, 'yemen.json'), JSON.stringify(data));
  writeFileSync(join(out, 'governorates.geojson'), JSON.stringify(adm1));
  writeFileSync(join(out, 'districts.geojson'), JSON.stringify(adm2));
  writeFileSync(join(out, 'governorate-labels.geojson'), JSON.stringify(points(governorates)));
  writeFileSync(join(out, 'district-labels.geojson'), JSON.stringify(points(districts)));
  console.log(`wrote ${Object.keys(governorates).length} governorates, ${Object.keys(districts).length} districts`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
