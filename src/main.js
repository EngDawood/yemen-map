import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './style.css';
import { createMap, YEMEN_BOUNDS } from './map.js';
import { createIndex, search } from './search.js';
import { strings, fmt } from './i18n.js';

const $ = (id) => document.getElementById(id);
const els = {
  title: $('app-title'),
  toggle: $('lang-toggle'),
  input: $('search'),
  results: $('search-results'),
  body: $('panel-body'),
  foot: $('panel-foot'),
};

const state = { lang: 'ar', gov: null, district: null };
try {
  if (localStorage.getItem('lang') === 'en') state.lang = 'en';
} catch {}

let data, index, mapApi;
const t = (key) => strings[state.lang][key];
const name = (item) => item.name[state.lang];
const other = (item) => item.name[state.lang === 'ar' ? 'en' : 'ar'];
const byName = (a, b) => name(a).localeCompare(name(b), state.lang);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Keep the selected area clear of the side panel (desktop) or bottom sheet (phone).
function cameraPadding() {
  const panel = document.getElementById('panel').getBoundingClientRect();
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  const p = { top: 40, bottom: 40, left: 40, right: 40 };
  if (mobile) p.bottom += panel.height;
  else p[document.dir === 'rtl' ? 'right' : 'left'] += panel.width + 16;
  return p;
}

// ---------- panel ----------

function stat(label, value, unit = '') {
  return `<div class="stat"><dt>${label}</dt><dd>${value}${unit ? ` <small>${unit}</small>` : ''}</dd></div>`;
}

function density(item) {
  return item.population ? fmt(item.population / item.area, state.lang) : '—';
}

function listItem(type, item) {
  return `<li><button type="button" data-${type}="${item.id}">
    <span>${esc(name(item))}</span><small>${fmt(item.population, state.lang)}</small>
  </button></li>`;
}

function crumbs(parts) {
  return `<nav class="crumbs">${parts
    .map(([label, attr]) => (attr ? `<button type="button" ${attr}>${esc(label)}</button>` : `<span>${esc(label)}</span>`))
    .join('<span class="sep" aria-hidden="true">›</span>')}</nav>`;
}

function renderOverview() {
  const govs = Object.values(data.governorates).sort(byName);
  const total = govs.reduce((s, g) => s + g.population, 0);
  const area = govs.reduce((s, g) => s + g.area, 0);
  return `
    <h2>${t('yemen')}</h2>
    <p class="hint">${t('hint')}</p>
    <dl class="stats">
      ${stat(t('population'), fmt(total, state.lang))}
      ${stat(t('area'), fmt(area, state.lang), t('km2'))}
      ${stat(t('governorates'), fmt(govs.length, state.lang))}
      ${stat(t('districts'), fmt(Object.keys(data.districts).length, state.lang))}
    </dl>
    <h3>${t('governorates')}</h3>
    <ul class="list">${govs.map((g) => listItem('gov', g)).join('')}</ul>`;
}

function renderGov(g) {
  const districts = g.districts.map((id) => data.districts[id]).sort(byName);
  return `
    ${crumbs([[t('yemen'), 'data-home']])}
    <p class="kind">${t('governorate')}</p>
    <h2>${esc(name(g))}</h2>
    <p class="alt" lang="${state.lang === 'ar' ? 'en' : 'ar'}">${esc(other(g))}</p>
    <dl class="stats">
      ${stat(t('capital'), esc(g.capital[state.lang]))}
      ${stat(t('population'), fmt(g.population, state.lang))}
      ${stat(t('area'), fmt(g.area, state.lang), t('km2'))}
      ${stat(t('density'), density(g), t('perKm2'))}
    </dl>
    <h3>${t('districts')} <small>(${fmt(districts.length, state.lang)})</small></h3>
    <ul class="list">${districts.map((d) => listItem('district', d)).join('')}</ul>`;
}

function renderDistrict(d) {
  const g = data.governorates[d.gov];
  return `
    ${crumbs([
      [t('yemen'), 'data-home'],
      [name(g), `data-gov="${g.id}"`],
    ])}
    <p class="kind">${t('district')}</p>
    <h2>${esc(name(d))}</h2>
    <p class="alt" lang="${state.lang === 'ar' ? 'en' : 'ar'}">${esc(other(d))}</p>
    <dl class="stats">
      ${stat(t('governorate'), `<button type="button" class="link" data-gov="${g.id}">${esc(name(g))}</button>`)}
      ${stat(t('population'), d.population == null ? t('noData') : fmt(d.population, state.lang))}
      ${stat(t('area'), fmt(d.area, state.lang), t('km2'))}
      ${stat(t('density'), density(d), d.population ? t('perKm2') : '')}
      ${d.idps ? stat(t('idps'), fmt(d.idps, state.lang)) : ''}
    </dl>`;
}

function render() {
  const d = state.district && data.districts[state.district];
  const g = state.gov && data.governorates[state.gov];
  els.body.innerHTML = d ? renderDistrict(d) : g ? renderGov(g) : renderOverview();
  els.body.scrollTop = 0;
}

function renderChrome() {
  const { lang } = state;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('title');
  els.title.textContent = t('title');
  els.toggle.textContent = t('toggle');
  els.toggle.lang = lang === 'ar' ? 'en' : 'ar';
  els.input.placeholder = t('search');
  els.input.setAttribute('aria-label', t('search'));
  els.foot.textContent = t('sources');
}

// ---------- navigation ----------

function frame() {
  const target = state.district ? data.districts[state.district] : state.gov ? data.governorates[state.gov] : null;
  mapApi.fit(target ? target.bbox : YEMEN_BOUNDS, cameraPadding());
}

function go(govId, districtId = null) {
  state.gov = govId;
  state.district = districtId;
  mapApi.select(govId, districtId);
  frame();
  render();
}

function setLang(lang) {
  state.lang = lang;
  try {
    localStorage.setItem('lang', lang);
  } catch {}
  renderChrome();
  render();
  mapApi.setLang(lang);
  frame(); // the panel switched sides
  updateResults();
}

// ---------- search ----------

let hits = [];
let active = -1;

function updateResults() {
  hits = search(index, els.input.value);
  active = hits.length ? 0 : -1;
  if (!els.input.value.trim()) {
    els.results.hidden = true;
    els.input.setAttribute('aria-expanded', 'false');
    return;
  }
  els.results.innerHTML = hits.length
    ? hits
        .map((h, i) => {
          const item = h.type === 'gov' ? data.governorates[h.id] : data.districts[h.id];
          const sub =
            h.type === 'gov' ? t('governorate') : `${t('district')} · ${name(data.governorates[item.gov])}`;
          return `<li role="option" id="hit-${i}" data-i="${i}" aria-selected="${i === active}">
            <span>${esc(name(item))}</span><small>${esc(sub)}</small></li>`;
        })
        .join('')
    : `<li class="empty">${t('noResults')}</li>`;
  els.results.hidden = false;
  els.input.setAttribute('aria-expanded', 'true');
  highlight();
}

function highlight() {
  [...els.results.querySelectorAll('[role=option]')].forEach((li, i) =>
    li.setAttribute('aria-selected', String(i === active)),
  );
  if (active >= 0) els.input.setAttribute('aria-activedescendant', `hit-${active}`);
  else els.input.removeAttribute('aria-activedescendant');
}

function choose(i) {
  const h = hits[i];
  if (!h) return;
  if (h.type === 'gov') go(h.id);
  else go(data.districts[h.id].gov, h.id);
  els.input.value = '';
  updateResults();
  els.input.blur();
}

// ---------- boot ----------

async function init() {
  renderChrome();
  const res = await fetch(`${import.meta.env.BASE_URL}data/yemen.json`);
  data = await res.json();
  index = createIndex(data);
  mapApi = await createMap('map', state.lang, cameraPadding());
  render();
  mapApi.map.on('click', (e) => {
    const hit = mapApi.pick(e.point);
    if (!hit) return go(null);
    if (hit.type === 'district') go(state.gov, hit.id);
    else go(hit.id);
  });

  els.toggle.addEventListener('click', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));

  document.getElementById('panel').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('home' in b.dataset) go(null);
    else if (b.dataset.gov) go(b.dataset.gov);
    else if (b.dataset.district) go(data.districts[b.dataset.district].gov, b.dataset.district);
  });

  // Hovering a list row highlights that area on the map.
  els.body.addEventListener('mouseover', (e) => {
    const b = e.target.closest('button[data-gov], button[data-district]');
    mapApi.hover(b && (b.dataset.gov ? { type: 'gov', id: b.dataset.gov } : { type: 'district', id: b.dataset.district }));
  });
  els.body.addEventListener('mouseleave', () => mapApi.hover(null));

  els.input.addEventListener('input', updateResults);
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && hits.length) active = (active + 1) % hits.length;
    else if (e.key === 'ArrowUp' && hits.length) active = (active - 1 + hits.length) % hits.length;
    else if (e.key === 'Enter') return choose(active);
    else if (e.key === 'Escape') {
      els.input.value = '';
      return updateResults();
    } else return;
    e.preventDefault();
    highlight();
  });
  els.results.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) {
      e.preventDefault();
      choose(Number(li.dataset.i));
    }
  });
  els.input.addEventListener('blur', () => {
    els.results.hidden = true;
    els.input.setAttribute('aria-expanded', 'false');
  });
  els.input.addEventListener('focus', () => els.input.value && updateResults());

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== els.input) {
      e.preventDefault();
      els.input.focus();
    } else if (e.key === 'Escape' && document.activeElement !== els.input && state.gov) {
      state.district ? go(state.gov) : go(null);
    }
  });
}

init().catch((err) => {
  console.error(err);
  els.body.textContent = String(err);
});
