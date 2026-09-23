// Bilingual search: "تعز", "Taiz" and "Ta'iz" all find the same place.

export function normalize(s) {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[̀-ͯ]/g, '') // Latin accents
    .replace(/['’`ʿʾ\-_.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function score(key, q) {
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  if (key.includes(' ' + q)) return 2;
  if (key.includes(q)) return 3;
  return Infinity;
}

// Governorates, districts and destination cities in one list. A city is also found by its
// country's name ("ماليزيا", "Malaysia"), ranked after direct name matches; cities are already
// sorted by size.
export function createGhurbaIndex(data, cities, countryNames) {
  const entries = [];
  for (const g of Object.values(data.governorates)) {
    const keys = [g.name.ar, g.name.en, g.slug, ...g.aliases];
    entries.push({ type: 'gov', id: g.id, keys: [...new Set(keys.map(normalize))] });
  }
  for (const d of Object.values(data.districts)) {
    entries.push({ type: 'district', id: d.id, keys: [normalize(d.name.ar), normalize(d.name.en)] });
  }
  for (const c of cities) {
    const keys = [c.name.ar, c.name.en, ...(c.aliases ?? [])];
    const extra = [...new Set(countryNames(c.country).map(normalize))];
    entries.push({ type: 'city', id: c.id, keys: [...new Set(keys.map(normalize))], extra });
  }
  return entries;
}

export function search(index, query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const hits = [];
  for (const e of index) {
    const s = Math.min(...e.keys.map((k) => score(k, q)), ...(e.extra ?? []).map((k) => score(k, q) + 2));
    if (s < Infinity) hits.push({ ...e, score: s + (e.type === 'gov' ? 0 : 0.5) });
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, limit);
}
