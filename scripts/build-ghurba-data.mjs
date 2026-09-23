// Builds the Ghurba map data in public/data:
//   cities.json   destination cities with Arabic and English names (GeoNames, CC BY 4.0)
//   land.geojson  world land for the globe (Natural Earth, public domain)
//   seas.geojson  named seas and oceans, to name the sea under a ship (Natural Earth, public domain)
//   npm run data:ghurba               everything
//   npm run data:ghurba -- seas       only the parts named: cities, land, seas
// Raw downloads (about 210 MB, mostly GeoNames alternate names) are cached in data-raw/.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'data-raw');
const out = join(root, 'public', 'data');

const SOURCES = {
  cities: 'https://download.geonames.org/export/dump/cities15000.zip',
  names: 'https://download.geonames.org/export/dump/alternateNamesV2.zip',
  land: 'https://naciscdn.org/naturalearth/50m/physical/ne_50m_land.zip',
  seas: 'https://naciscdn.org/naturalearth/50m/physical/ne_50m_geography_marine_polys.zip',
};

// Lowest population kept per country. Where most Yemenis abroad live the cut-off is low;
// countries with small communities keep only their big cities. Capitals are always kept.
const MIN_POPULATION = {
  // Gulf (the list starts at 15,000, so 0 keeps every city)
  SA: 0, AE: 50_000, OM: 30_000, QA: 50_000, KW: 50_000, BH: 30_000,
  // Arab world and the Horn of Africa
  EG: 100_000, JO: 100_000, SD: 100_000, DJ: 0, SO: 50_000, ER: 0, ET: 300_000, KE: 300_000,
  TZ: 500_000, IQ: 300_000, SY: 300_000, LB: 100_000, PS: 100_000, LY: 200_000, DZ: 500_000,
  MA: 500_000, TN: 300_000, MR: 300_000,
  // Other countries with sizeable communities
  MY: 300_000, TR: 500_000, US: 500_000, GB: 300_000, CA: 700_000,
  // Very populous countries with small communities
  CN: 5_000_000, IN: 3_000_000,
};
const DEFAULT_MIN = 1_000_000;

// Known Yemeni communities below the cut-off. Matched by name and country; the biggest match wins.
const EXTRA = [
  ['Dearborn', 'US'], ['Dearborn Heights', 'US'], ['Hamtramck', 'US'], ['Warren', 'US'],
  ['Sterling Heights', 'US'], ['Detroit', 'US'], ['Lackawanna', 'US'], ['Buffalo', 'US'],
  ['Paterson', 'US'], ['Jersey City', 'US'],
  ['Oakland', 'US'], ['San Francisco', 'US'], ['Sacramento', 'US'], ['Stockton', 'US'],
  ['Fresno', 'US'], ['Bakersfield', 'US'], ['Delano', 'US'], ['Minneapolis', 'US'],
  ['South Shields', 'GB'], ['Newport', 'GB'], ['Cardiff', 'GB'], ['Middlesbrough', 'GB'],
  ['Kingston upon Hull', 'GB'], ['Windsor', 'CA'], ['Yiwu', 'CN'], ['Guangzhou', 'CN'],
  ['Aurangabad', 'IN'], ['Pune', 'IN'], ['Hyderabad', 'IN'], ['George Town', 'MY'],
  ['Johor Bahru', 'MY'], ['Hargeysa', 'SO'], ['Berbera', 'SO'], ['Bosaso', 'SO'],
  ['Mombasa', 'KE'], ['Zanzibar', 'TZ'], ['Irbid', 'JO'],
];

// Districts and suburbs that GeoNames lists as cities. Destinations are whole cities, so these
// (and every PPLX "section of a populated place") are dropped, and their names become search
// aliases of the nearest city that is kept: "Brooklyn" finds New York. Names or GeoNames ids.
const PARTS = new Set([
  'Brooklyn', 'Queens', 'Manhattan', 'The Bronx', 'Islington', 'Esenyurt', 'Kuecuekcekmece',
  'Bagcilar', 'Bahcelievler', 'Umraniye', 'UEskuedar', 'Esenler', 'Cankaya', 'Niluefer', 'Pudong',
  'Wuzhong', 'Iztapalapa', 'Gustavo Adolfo Madero', 'Sadr City', 'Budta', 'Malingao',
  'Kampung Baru Subang', 'Bukit Rahman Putra', 'Pelentong', 'Kota Kuala Muda',
  'Selayang Baru Utara', 'Mukim Pulai', 'Kampung Larkin Lama', 'Kota Damansara', 'Taman Petaling',
  'Kampung Kangkar Teberau', 'Setapak', 'Ruiru', 'Kikuyu', 'Camayenne', 'Abobo', 'El Geneina Fort',
  'Rahimah', '110059', // next to Ras Tanura; a duplicate of Al 'Aqiq
]);

// Yemen is the origin, not a destination (displacement inside Yemen is a separate topic).
// Israel is left out for the audience; remove it from this set to include it.
const EXCLUDE = new Set(['YE', 'IL']);

// Arabic names that GeoNames lacks or gets wrong (a district name for Casablanca, no article
// for Khartoum), and English ones where its main name is not the usual one.
const NAME_FIX = {
  // Gulf
  109223: { ar: 'المدينة المنورة' }, 292968: { ar: 'أبوظبي' }, 105299: { ar: 'جازان' },
  101760: { ar: 'سلطانة' }, 101732: { ar: 'عنيزة' }, 110325: { ar: 'الدوادمي' },
  12495725: { ar: 'بارق' }, 103035: { ar: 'رابغ' }, 109253: { ar: 'الليث' }, 101313: { ar: 'طريف' },
  104828: { ar: 'مدينة الملك فيصل العسكرية' }, 109380: { ar: 'الخفجي' }, 102891: { ar: 'رأس تنورة' },
  101516: { ar: 'تيماء' }, 13631408: { ar: 'حوطة بني تميم' }, 104716: { ar: 'ليلى' },
  109306: { ar: 'الخرمة' }, 107744: { ar: 'بدر' }, 409682: { ar: 'ثول' }, 102451: { ar: 'صامطة' },
  106102: { ar: 'حقل' }, 108048: { ar: 'السليل' }, 101322: { ar: 'تربة' }, 104578: { ar: 'مهد الذهب' },
  104923: { ar: 'خليص' }, 110060: { ar: 'العقيق' }, 109915: { ar: 'البطالية' },
  109059: { ar: 'المنيزلة' }, 110250: { ar: 'عفيف' }, 101554: { ar: 'تاروت' },
  13118447: { ar: 'مدينة محمد بن زايد' }, 13118438: { ar: 'الصجعة' }, 290680: { ar: 'كلباء' },
  292878: { ar: 'الفجيرة' }, 13512674: { ar: 'لوسيل' }, 290332: { ar: 'المحرق' },
  287830: { ar: 'عبري' }, 286647: { ar: 'صحم' }, 286245: { ar: 'صور' }, 286293: { ar: 'سفالة سمائل' },
  // Arab world
  379252: { ar: 'الخرطوم' }, 372753: { ar: 'كسلا' }, 379003: { ar: 'الأبيض' }, 371760: { ar: 'كوستي' },
  364103: { ar: 'ود مدني' }, 379149: { ar: 'المناقل' }, 2553604: { ar: 'الدار البيضاء' },
  2538475: { ar: 'الرباط' }, 359796: { ar: 'السويس' }, 360761: { ar: 'المنصورة' },
  360890: { ar: 'الخصوص' }, 353802: { ar: 'كوم أمبو' }, 353219: { ar: 'مدينة السادس من أكتوبر' },
  355628: { ar: 'إدكو' }, 361179: { ar: 'الحوامدية' }, 347907: { ar: 'سنورس' }, 358600: { ar: 'بوش' },
  250090: { ar: 'الزرقاء' }, 173576: { ar: 'اللاذقية' }, 99532: { ar: 'البصرة' }, 99131: { ar: 'الكوت' },
  96994: { ar: 'دهوك' }, 95446: { ar: 'أربيل' }, 99608: { ar: 'العمارة' }, 13631407: { ar: 'أبو الخصيب' },
  267008: { ar: 'صور' }, 278913: { ar: 'النبطية' },
  // Elsewhere
  4140963: { ar: 'واشنطن', en: 'Washington, D.C.' }, 314830: { ar: 'غازي عنتاب' },
  308464: { ar: 'قيصري' }, 304531: { ar: 'مرسين' }, 1814870: { ar: 'ييوو' },
  2637329: { ar: 'ساوث شيلدز' }, 2645425: { ar: 'هل' }, 2655613: { ar: 'بيركنهيد' },
  2639577: { ar: 'ريدينغ' }, 1526273: { ar: 'أستانا' }, 2993458: { ar: 'موناكو' },
  6691831: { ar: 'الفاتيكان' }, 1282027: { ar: 'ماليه' }, 2422465: { ar: 'كوناكري' },
  3492908: { ar: 'سانتو دومينغو' }, 3703443: { ar: 'بنما' }, 1221874: { ar: 'دوشنبه' },
  2389853: { ar: 'بانغي' }, 6611854: { ar: 'نايبيداو' }, 3489854: { ar: 'كينغستون' },
  2111149: { ar: 'سنداي' }, 472045: { ar: 'فورونيج' }, 128747: { ar: 'كرج' }, 1169825: { ar: 'ملتان' },
  1177662: { ar: 'غوجرانوالا' }, 1255364: { ar: 'سورت' }, 1645524: { ar: 'ديبوك' },
  1625084: { ar: 'تانجيرانج' }, 1622786: { ar: 'ماكاسار' }, 1631761: { ar: 'بكنبارو' },
  1624917: { ar: 'بندر لامبونج' }, 3461786: { ar: 'غوارولوس' }, 1692192: { ar: 'كويزون سيتي' },
  12908892: { ar: 'تايبيه الجديدة' }, 1791681: { ar: 'ويفانغ' }, 1787093: { ar: 'يانتاي' },
  2326016: { ar: 'أونيتشا' }, 333795: { ar: 'جيجيغا' }, 336014: { ar: 'غوندار' },
  10063567: { ar: 'إسكندر بوتري' }, 1735498: { ar: 'سونغاي بتاني' }, 1749822: { ar: 'بوتشونغ' },
  1734199: { ar: 'تاواو' }, 1732811: { ar: 'كلوانغ' }, 1732869: { ar: 'موار' },
  1732722: { ar: 'باسير غودانغ' }, 195272: { ar: 'كاكاميغا' }, 184622: { ar: 'ناكورو' },
  198629: { ar: 'إلدوريت' }, 331180: { ar: 'مقلي' }, 330186: { ar: 'أداما' }, 343137: { ar: 'أواسا' },
  1720151: { ar: 'كالوكان' }, 1684308: { ar: 'تاغيغ' }, 1679432: { ar: 'زامبوانغا' },
  3529612: { ar: 'إيكاتيبيك' }, 3998655: { ar: 'ليون' }, 3530589: { ar: 'نيزاهوالكويوتل' },
  8581443: { ar: 'جنوب تانجيرانج' }, 1183460: { ar: 'بنو' }, 2246678: { ar: 'بيكين' },
  2244322: { ar: 'طوبى' }, 1842485: { ar: 'غويانغ' }, 426272: { ar: 'جيتيغا' }, 3042030: { ar: 'فادوز' },
};

// Sea names Natural Earth gets wrong (Syracuse for Sargasso, straits without "strait"), by
// English name. The Gulf is named as the Arabic name already has it.
const SEA_FIX = {
  'Persian Gulf': { en: 'Arabian Gulf' },
  'Sargasso Sea': { ar: 'بحر سارغاسو' },
  'Florida Strait': { ar: 'مضيق فلوريدا' },
  'Korea Strait': { ar: 'مضيق كوريا' },
  'Gulf of Bothnia': { ar: 'خليج بوثنيا' },
  'Seto Inland Sea': { ar: 'بحر سيتو الداخلي' },
};

async function download(url, file) {
  if (existsSync(file)) return;
  console.log('downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// Streams one file out of a zip without writing it to disk.
async function* zipLines(zip, entry) {
  const child = spawn('unzip', ['-p', zip, entry]);
  yield* createInterface({ input: child.stdout, crlfDelay: Infinity });
}

async function readCities(zip) {
  const cities = new Map();
  for await (const line of zipLines(zip, 'cities15000.txt')) {
    const c = line.split('\t');
    cities.set(c[0], {
      id: c[0],
      name: c[1],
      ascii: c[2],
      lat: Number(c[4]),
      lon: Number(c[5]),
      code: c[7],
      country: c[8],
      population: Number(c[14]) || 0,
    });
  }
  return cities;
}

function select(cities) {
  const picked = new Map();
  const parts = [];
  for (const c of cities.values()) {
    if (EXCLUDE.has(c.country)) continue;
    const min = MIN_POPULATION[c.country] ?? DEFAULT_MIN;
    if (c.code !== 'PPLC' && c.population < min) continue;
    if (c.code === 'PPLX' || PARTS.has(c.ascii) || PARTS.has(c.id)) parts.push(c);
    else picked.set(c.id, c);
  }
  for (const [name, country] of EXTRA) {
    const [match] = [...cities.values()]
      .filter((c) => c.country === country && (c.name === name || c.ascii === name))
      .sort((a, b) => b.population - a.population);
    if (!match) throw new Error(`no GeoNames city for ${name}, ${country}`);
    picked.set(match.id, match);
  }
  return { picked, parts };
}

// Great-circle distance in km.
function distance(a, b) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Arabic and English names per city, leaving out historic and colloquial ones. Short forms
// (such as "مكة" for Mecca) only become search aliases.
async function readNames(zip, ids) {
  const names = new Map();
  for await (const line of zipLines(zip, 'alternateNamesV2.txt')) {
    const c = line.split('\t');
    const lang = c[2];
    if ((lang !== 'ar' && lang !== 'en') || !ids.has(c[1])) continue;
    if (c[6] === '1' || c[7] === '1') continue; // isColloquial, isHistoric
    const entry = names.get(c[1]) ?? { ar: [], en: [], display: [] };
    const name = lang === 'ar' ? arabic(c[3]) : c[3].trim();
    // Some "Arabic" entries are transliterations in Latin letters.
    if (lang === 'ar' && /[A-Za-zÀ-ž]/.test(name)) continue;
    entry[lang].push(name);
    if (lang === 'ar' && c[5] !== '1') entry.display.push(name); // isShortName
    names.set(c[1], entry);
  }
  return names;
}

// Tashkeel removed except shadda (عمّان, not عمان), Arabic ي and ك where some entries use the
// Persian letters, plain alef forms, and no stray direction marks.
const arabic = (s) =>
  s
    .replace(/[\u064B-\u0650\u0652-\u065F\u0670]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/ی/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/ٲ/g, 'أ')
    .replace(/ٱ/g, 'ا')
    .trim();

// The shortest full Arabic name is usually the plain city name: "الشارقة" rather than
// "إمارة الشارقة". NAME_FIX covers the exceptions.
const shortest = (list) => list.reduce((best, n) => (best === undefined || n.length < best.length ? n : best), undefined);

// Same folding as src/search.js, to drop aliases that search would treat as duplicates.
function fold(s) {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`ʿʾ\-_.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const round = (v) => +v.toFixed(3);

async function buildCities() {
  const citiesZip = join(raw, 'cities15000.zip');
  const namesZip = join(raw, 'alternateNamesV2.zip');
  await download(SOURCES.cities, citiesZip);
  await download(SOURCES.names, namesZip);

  const { picked, parts } = select(await readCities(citiesZip));
  const names = await readNames(namesZip, new Set([...picked.keys(), ...parts.map((p) => p.id)]));
  const nameOf = (c) => {
    const n = names.get(c.id);
    const en = NAME_FIX[c.id]?.en ?? c.ascii;
    return { en, ar: NAME_FIX[c.id]?.ar ?? shortest(n?.display ?? []) ?? n?.ar[0] ?? en };
  };

  // Each part's names go to the nearest kept city within 60 km.
  const partNames = new Map();
  for (const part of parts) {
    let best, bestKm = 60;
    for (const c of picked.values()) {
      const km = distance(part, c);
      if (km < bestKm) [best, bestKm] = [c, km];
    }
    if (!best) continue;
    const { ar, en } = nameOf(part);
    partNames.set(best.id, [...(partNames.get(best.id) ?? []), en, ar]);
  }

  const list = [...picked.values()]
    .sort((a, b) => b.population - a.population)
    .map((c) => {
      const n = names.get(c.id) ?? { ar: [], en: [] };
      const name = nameOf(c);
      const seen = new Set([fold(name.ar), fold(name.en)]);
      const aliases = [];
      const add = (a, max) => {
        const key = fold(a);
        if (!key || seen.has(key) || aliases.length >= max) return;
        seen.add(key);
        aliases.push(a);
      };
      for (const a of [...n.ar, ...n.en, c.name]) add(a, 4);
      for (const a of partNames.get(c.id) ?? []) add(a, 16);
      return {
        id: c.id,
        name,
        country: c.country,
        center: [round(c.lon), round(c.lat)],
        ...(aliases.length && { aliases }),
      };
    });

  writeFileSync(join(out, 'cities.json'), JSON.stringify(list));
  const noArabic = list.filter((c) => c.name.ar === c.name.en).length;
  console.log(
    `wrote ${list.length} cities in ${new Set(list.map((c) => c.country)).size} countries ` +
      `(${noArabic} without an Arabic name, ${parts.length} districts merged)`,
  );
}

async function buildLand() {
  const zip = join(raw, 'ne_50m_land.zip');
  await download(SOURCES.land, zip);
  const dir = join(raw, 'land');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  // Islands under 200 km² are dropped (Bahrain, Malta and Socotra stay); they add size, not shape.
  // Outer rings are written clockwise, as d3-geo expects for the share card; MapLibre takes either.
  await mapshaper.runCommands(
    `-i "${join(dir, 'ne_50m_land.shp')}" -filter-islands min-area=200km2 remove-empty ` +
      `-simplify 20% weighted keep-shapes -filter-fields ` +
      `-o "${join(out, 'land.geojson')}" format=geojson precision=0.01 reverse-winding`,
  );
  console.log('wrote land.geojson');
}

async function buildSeas() {
  const zip = join(raw, 'ne_50m_geography_marine_polys.zip');
  await download(SOURCES.seas, zip);
  const dir = join(raw, 'seas');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  // Only used to find which sea a point is in, so rough shapes do (about 50 KB). Rivers and reefs
  // are not seas. The polygons do not overlap: a point is in one sea at most.
  const tmp = join(dir, 'seas.geojson');
  await mapshaper.runCommands(
    `-i "${join(dir, 'ne_50m_geography_marine_polys.shp')}" -filter "featurecla != 'river' && featurecla != 'reef'" ` +
      `-simplify 3% weighted keep-shapes -filter-fields name_ar,name_en -o "${tmp}" format=geojson precision=0.05`,
  );
  const features = JSON.parse(readFileSync(tmp, 'utf8'))
    .features.filter((f) => f.geometry)
    .map(({ properties: p, geometry }) => ({
      type: 'Feature',
      properties: { ar: SEA_FIX[p.name_en]?.ar ?? p.name_ar, en: SEA_FIX[p.name_en]?.en ?? p.name_en },
      geometry,
    }));
  writeFileSync(join(out, 'seas.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`wrote ${features.length} seas`);
}

const BUILDS = { cities: buildCities, land: buildLand, seas: buildSeas };

async function main() {
  mkdirSync(raw, { recursive: true });
  mkdirSync(out, { recursive: true });
  const only = process.argv.slice(2);
  for (const [name, build] of Object.entries(BUILDS)) if (!only.length || only.includes(name)) await build();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
