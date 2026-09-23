// Ghurba mode: the map of Yemenis abroad. Loads the aggregated lines, draws them on the globe
// and fills the side panel: the counter, exploring by governorate or city, messages, your card.
import { greatCircle } from './globe.js';
import { createGhurbaIndex, search } from './search.js';
import { strings, fmt, plural, fill } from './i18n.js';
import { esc, stat, crumbs } from './ui.js';
import { openAddLine, closeAddLine, addLineOpen } from './add-line.js';
import { renderCard } from './card.js';
import { countryName, regionNames } from './countries.js';

const MINE_KEY = 'ghurba-mine';
// Numbers below this are not shown (the line still is), so small places do not point at a person.
const SHOW_FROM = 3;
const YEMEN = [47.5, 15.6];

function readMine() {
  try {
    const m = JSON.parse(localStorage.getItem(MINE_KEY));
    return m?.d && m?.c ? m : null;
  } catch {
    return null;
  }
}

function saveMine(m) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(m));
  } catch {}
}

export function createGhurba({ state, data, mapApi, body, padding, onChange }) {
  const globe = mapApi.globe;
  const view = { gov: null, city: null, mine: false };
  let status = 'idle'; // idle | loading | ready | error
  let cities = [];
  let cityById = new Map();
  let index = [];
  let cityIndex = [];
  let lines = []; // [{ d: district id, c: city id, n }]
  let messages = []; // [{ g: governorate id, c: city id, m: text }]
  let agg = aggregate();
  let mine = readMine(); // { d, c, n } once this browser has drawn its line
  let card = null; // { key, blob, url }
  let loading = null;

  const t = (k) => strings[state.lang][k];
  const nm = (item) => item.name[state.lang];
  const govName = (id) => nm(data.governorates[id]);
  const districtName = (id) => nm(data.districts[id]);
  const cityName = (id) => (cityById.has(id) ? nm(cityById.get(id)) : '');
  const listCount = (n) => (n >= SHOW_FROM ? fmt(n, state.lang) : '');
  const statCount = (n) => (n >= SHOW_FROM ? fmt(n, state.lang) : t('under3'));
  const origin = (d) => data.districts[d].center;
  const overview = () => !view.gov && !view.city && !view.mine;

  globe.canSpin = () => state.mode === 'ghurba' && overview() && !addLineOpen();
  for (const type of ['mousedown', 'touchstart', 'wheel']) {
    mapApi.map.on(type, () => state.mode === 'ghurba' && globe.pauseForUser());
  }

  // ---------- data ----------

  async function load() {
    status = 'loading';
    render();
    const base = import.meta.env.BASE_URL;
    const json = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`))));
    const linesReq = json('/api/lines');
    linesReq.catch(() => {}); // handled below, after the cities
    globe.setLand(`${base}data/land.geojson`);
    try {
      cities = await json(`${base}data/cities.json`);
      cityById = new Map(cities.map((c) => [c.id, c]));
      index = createGhurbaIndex(data, cities, (code) => [countryName(code, 'ar'), countryName(code, 'en'), regionNames.ar.of(code)]);
      cityIndex = index.filter((e) => e.type === 'city');
      const res = await linesReq;
      // Ids a later data update may have dropped are skipped rather than breaking the page.
      lines = res.lines.filter((l) => data.districts[l.d] && cityById.has(l.c));
      messages = res.messages.filter((m) => data.governorates[m.g] && cityById.has(m.c));
      status = 'ready';
    } catch (err) {
      console.warn('Ghurba data unavailable.', err);
      status = 'error';
    }
    // The public counts are cached for a minute; keep this browser's own line on its map.
    if (mine && !lines.some((l) => l.d === mine.d && l.c === mine.c) && cityById.has(mine.c)) {
      lines.push({ d: mine.d, c: mine.c, n: 1 });
    }
    agg = aggregate();
    globe.setLines(lineFeatures());
    applyView();
    render();
  }

  function aggregate() {
    const byGov = new Map(); // gov → { n, cities: Map(city → n) }
    const byCity = new Map(); // city → { n, govs: Map(gov → n) }
    let total = 0;
    for (const { d, c, n } of lines) {
      const g = d.slice(0, 4);
      total += n;
      const G = byGov.get(g) ?? { n: 0, cities: new Map() };
      G.n += n;
      G.cities.set(c, (G.cities.get(c) ?? 0) + n);
      byGov.set(g, G);
      const C = byCity.get(c) ?? { n: 0, govs: new Map() };
      C.n += n;
      C.govs.set(g, (C.govs.get(g) ?? 0) + n);
      byCity.set(c, C);
    }
    const countries = new Set([...byCity.keys()].map((c) => cityById.get(c)?.country)).size;
    return { byGov, byCity, total, countries, cities: byCity.size };
  }

  // Each district-to-city pair is one feature, whatever its count; the count sets its width.
  function lineFeatures() {
    return lines.map(({ d, c, n }) => ({
      type: 'Feature',
      properties: { d, c, g: d.slice(0, 4), n },
      geometry: greatCircle(origin(d), cityById.get(c).center),
    }));
  }

  function cityFeatures(counts) {
    return [...counts].map(([id, n]) => {
      const c = cityById.get(id);
      return {
        type: 'Feature',
        properties: { id, n, ar: c.name.ar, en: c.name.en },
        geometry: { type: 'Point', coordinates: c.center },
      };
    });
  }

  // ---------- view ----------

  // The map side of the current view: which lines, which cities, which governorates are lit.
  function applyView({ drawMine = true } = {}) {
    // Also skipped when the visitor left the globe while the data was loading.
    if (state.mode !== 'ghurba' || status === 'idle' || status === 'loading') return;
    const { gov, city } = view;
    globe.filterLines(gov ? { gov } : city ? { city } : null);
    const counts = gov
      ? (agg.byGov.get(gov)?.cities ?? new Map())
      : city
        ? new Map([[city, agg.byCity.get(city)?.n ?? 0]])
        : new Map([...agg.byCity].map(([id, c]) => [id, c.n]));
    globe.setCities(cityFeatures(counts), state.lang);
    globe.highlightGovs(gov ? [gov] : city ? [...(agg.byCity.get(city)?.govs.keys() ?? [])] : null);
    const mineHere = mine && (view.mine || overview() || gov === mine.d.slice(0, 4) || city === mine.c);
    if (!mineHere) globe.clearMine();
    else if (drawMine) globe.drawMine(origin(mine.d), cityById.get(mine.c).center, false);
  }

  function select({ gov = null, city = null, mine: showMine = false } = {}) {
    const wasOverview = overview();
    Object.assign(view, { gov, city, mine: showMine && !!mine });
    applyView();
    if (view.city) globe.frameLine(YEMEN, cityById.get(view.city).center, padding());
    else if (view.mine) globe.frameLine(origin(mine.d), cityById.get(mine.c).center, padding());
    else if (view.gov || !wasOverview) globe.overview(padding()); // the whole globe; spins only in the overview
    render();
    onChange();
  }

  // After a successful submission: count the line, fly to it and draw it.
  function added({ d, c, n }) {
    mine = { d, c, n };
    saveMine(mine);
    const line = lines.find((l) => l.d === d && l.c === c);
    if (line) line.n += 1;
    else lines.push({ d, c, n: 1 });
    agg = aggregate();
    globe.setLines(lineFeatures());
    Object.assign(view, { gov: null, city: null, mine: true });
    applyView({ drawMine: false });
    globe.clearMine();
    globe.frameLine(origin(d), cityById.get(c).center, padding());
    mapApi.map.once('moveend', () => globe.drawMine(origin(d), cityById.get(c).center, true));
    render();
    onChange();
  }

  // ---------- panel ----------

  function notice() {
    if (status === 'loading') return `<p class="hint">${t('loading')}</p>`;
    if (status === 'error') return `<p class="notice">${t('loadError')}</p>`;
    if (!agg.total) return `<p class="hint">${t('empty')}</p>`;
    return '';
  }

  function counter() {
    const lang = state.lang;
    return fill(t('counter'), {
      people: `<b>${plural(t('nPeople'), agg.total, lang)}</b>`,
      countries: `<b>${plural(t('nCountries'), agg.countries, lang)}</b>`,
      cities: `<b>${plural(t('nCities'), agg.cities, lang)}</b>`,
    });
  }

  function actions() {
    if (!mine) return `<button type="button" class="primary" data-add>${t('addLine')}</button>`;
    return `<div class="mine-row">
      <p>${esc(fill(t('myLine'), { from: districtName(mine.d), to: cityName(mine.c) }))}</p>
      <button type="button" class="secondary" data-mine>${t('myCard')}</button>
    </div>`;
  }

  function cityItem(id, n) {
    const c = cityById.get(id);
    return `<li><button type="button" data-city="${id}">
      <span>${esc(nm(c))} <small>${esc(countryName(c.country, state.lang))}</small></span><small>${listCount(n)}</small>
    </button></li>`;
  }

  function govItem(id, n) {
    return `<li><button type="button" data-gov="${id}">
      <span>${esc(govName(id))}</span><small>${listCount(n)}</small>
    </button></li>`;
  }

  function messageList(list) {
    if (!list.length) return '';
    return `<h3>${t('messages')}</h3><ul class="messages">${list
      .slice(0, 8)
      .map(
        (m) =>
          `<li><q>${esc(m.m)}</q><small>${esc(fill(t('messageFrom'), { gov: govName(m.g), city: cityName(m.c) }))}</small></li>`,
      )
      .join('')}</ul>`;
  }

  function renderOverview() {
    const top = [...agg.byCity].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
    const govs = [...agg.byGov].sort((a, b) => b[1].n - a[1].n);
    return `
      <h2>${t('ghurbaTitle')}</h2>
      <p class="hint">${t('ghurbaIntro')}</p>
      ${notice()}
      ${agg.total ? `<p class="counter">${counter()}</p>` : ''}
      ${actions()}
      ${top.length ? `<h3>${t('topCities')}</h3><ul class="list">${top.map(([id, c]) => cityItem(id, c.n)).join('')}</ul>` : ''}
      ${govs.length ? `<h3>${t('topGovs')}</h3><ul class="list">${govs.map(([id, g]) => govItem(id, g.n)).join('')}</ul>` : ''}
      ${messageList(messages)}`;
  }

  function renderGov(id) {
    const g = agg.byGov.get(id);
    const list = g ? [...g.cities].sort((a, b) => b[1] - a[1]) : [];
    const countries = new Set(list.map(([c]) => cityById.get(c).country)).size;
    const lang = state.lang;
    return `
      ${crumbs([[t('ghurbaTitle'), 'data-ghome'], [govName(id)]])}
      <p class="kind">${t('governorate')}</p>
      <h2>${esc(fill(t('whereGov'), { gov: govName(id) }))}</h2>
      ${
        g
          ? `<dl class="stats">${stat(t('people'), statCount(g.n))}${stat(t('countries'), fmt(countries, lang))}${stat(t('cities'), fmt(list.length, lang))}</dl>`
          : `<p class="hint">${esc(fill(t('noLinesGov'), { gov: govName(id) }))}</p>`
      }
      ${mine ? '' : `<button type="button" class="primary" data-add>${t('addLine')}</button>`}
      ${list.length ? `<h3>${t('topCities')}</h3><ul class="list">${list.slice(0, 30).map(([c, n]) => cityItem(c, n)).join('')}</ul>` : ''}
      ${messageList(messages.filter((m) => m.g === id))}`;
  }

  function renderCity(id) {
    const c = cityById.get(id);
    const C = agg.byCity.get(id);
    const list = C ? [...C.govs].sort((a, b) => b[1] - a[1]) : [];
    return `
      ${crumbs([[t('ghurbaTitle'), 'data-ghome'], [nm(c)]])}
      <p class="kind">${esc(countryName(c.country, state.lang))}</p>
      <h2>${esc(fill(t('whereCity'), { city: nm(c) }))}</h2>
      ${
        C
          ? `<dl class="stats">${stat(t('people'), statCount(C.n))}${stat(t('governorates'), fmt(list.length, state.lang))}</dl>`
          : `<p class="hint">${esc(fill(t('noLinesCity'), { city: nm(c) }))}</p>`
      }
      ${mine ? '' : `<button type="button" class="primary" data-add>${t('addLine')}</button>`}
      ${list.length ? `<h3>${t('topGovs')}</h3><ul class="list">${list.map(([g, n]) => govItem(g, n)).join('')}</ul>` : ''}
      ${messageList(messages.filter((m) => m.c === id))}`;
  }

  // "You are one of N from Hajjah in Riyadh", with N counted per governorate and city.
  function sentence(html) {
    const g = mine.d.slice(0, 4);
    const n = Math.max(mine.n ?? 1, agg.byGov.get(g)?.cities.get(mine.c) ?? 1);
    const wrap = (s) => (html ? `<b>${esc(s)}</b>` : s);
    return fill(t(n > 1 ? 'oneOf' : 'firstOf'), {
      n: wrap(fmt(n, state.lang)),
      gov: wrap(govName(g)),
      city: wrap(cityName(mine.c)),
    });
  }

  const siteUrl = () => `${location.origin}/?view=ghurba`;

  function renderMine() {
    const text = `${sentence(false)}\n${t('shareText')} ${siteUrl()}`;
    return `
      ${crumbs([[t('ghurbaTitle'), 'data-ghome'], [t('myCard')]])}
      <p class="moment">${sentence(true)}</p>
      <figure class="card-preview"><img id="card-img" alt="${esc(t('cardAlt'))}" hidden /></figure>
      <div class="share">
        <a class="btn" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${t('shareWhatsapp')}</a>
        <button type="button" class="btn" id="share-story" hidden>${t('shareStory')}</button>
        <a class="btn" id="share-download" download="ghurba-map.png" hidden>${t('shareDownload')}</a>
      </div>`;
  }

  // The card is drawn on a canvas once per line, language and count, then reused.
  const cardKey = () => `${state.lang}|${mine.d}|${mine.c}|${sentence(false)}`;

  async function fillCard() {
    const key = cardKey();
    if (card?.key !== key) {
      const blob = await renderCard({
        from: origin(mine.d),
        to: cityById.get(mine.c).center,
        sentence: sentence(false),
        brand: t('cardBrand'),
        call: `${t('cardCall')} · ${location.host}`,
        lang: state.lang,
      });
      if (key !== cardKey()) return; // the language or count changed while drawing
      if (card) URL.revokeObjectURL(card.url);
      card = { key, blob, url: URL.createObjectURL(blob) };
    }
    const img = document.getElementById('card-img');
    if (!img) return; // the panel moved on while drawing
    img.src = card.url;
    img.hidden = false;
    const download = document.getElementById('share-download');
    download.href = card.url;
    download.hidden = false;
    const file = new File([card.blob], 'ghurba-map.png', { type: 'image/png' });
    document.getElementById('share-story').hidden = !navigator.canShare?.({ files: [file] });
  }

  async function shareStory() {
    if (!card) return;
    const file = new File([card.blob], 'ghurba-map.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file], text: `${sentence(false)}\n${siteUrl()}` });
    } catch {} // dismissed
  }

  function render() {
    if (state.mode !== 'ghurba') return;
    const showMine = view.mine && mine && status !== 'loading' && cityById.has(mine.c);
    body.innerHTML = showMine
      ? renderMine()
      : status === 'idle' || status === 'loading'
        ? renderOverview()
        : view.city
          ? renderCity(view.city)
          : view.gov
            ? renderGov(view.gov)
            : renderOverview();
    body.scrollTop = 0;
    if (showMine) fillCard().catch((err) => console.error('Card failed', err));
  }

  function openAdd() {
    globe.stopSpin();
    openAddLine({
      lang: state.lang,
      data,
      cities: cityById,
      searchCities: (q) => search(cityIndex, q, 8),
      countryName,
      onAdded: added,
      onClose: () => globe.startSpin(),
    });
  }

  return {
    async enter(initial = {}) {
      Object.assign(view, { gov: initial.gov ?? null, city: initial.city ?? null, mine: false });
      globe.enter(padding());
      render();
      if (status === 'idle' || status === 'error') {
        loading ??= load().finally(() => (loading = null));
        await loading;
      } else applyView();
      if (view.city && cityById.has(view.city)) globe.frameLine(YEMEN, cityById.get(view.city).center, padding());
      else if (view.city) select({});
    },

    leave() {
      closeAddLine();
      globe.leave();
    },

    render,

    setLang() {
      globe.setLang(state.lang);
      globe.setPadding(padding()); // the panel switched sides
      render();
    },

    search: (q) => search(index, q),

    hitLabel(hit) {
      if (hit.type === 'gov') return { name: govName(hit.id), sub: t('governorate') };
      const c = cityById.get(hit.id);
      return { name: nm(c), sub: countryName(c.country, state.lang) };
    },

    choose(hit) {
      select(hit.type === 'gov' ? { gov: hit.id } : { city: hit.id });
    },

    // A click on the globe: a city, one of Yemen's governorates, or empty space.
    click(hit) {
      if (hit?.type === 'city') select({ city: hit.id });
      else if (hit?.type === 'gov') select({ gov: hit.id });
      else if (!overview()) select({});
    },

    panelClick(b) {
      if ('ghome' in b.dataset) select({});
      else if (b.dataset.city) select({ city: b.dataset.city });
      else if (b.dataset.gov) select({ gov: b.dataset.gov });
      else if ('add' in b.dataset) openAdd();
      else if ('mine' in b.dataset) select({ mine: true });
      else if (b.id === 'share-story') shareStory();
    },

    // Escape goes back to the overview.
    back() {
      if (overview()) return false;
      select({});
      return true;
    },

    // For the address bar: ?view=ghurba, plus &gov=<slug> or &city=<GeoNames id>.
    params() {
      const p = new URLSearchParams({ view: 'ghurba' });
      if (view.gov) p.set('gov', data.governorates[view.gov].slug);
      if (view.city) p.set('city', view.city);
      return p;
    },
  };
}
