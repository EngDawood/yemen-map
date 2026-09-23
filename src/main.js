// Only the Sans family; the browser fetches each weight from the CDN the first time it is used.
import '@dawod/thmanyah-font-web/sans.css';
import './style.css';
import { createMap } from './map.js';
import { strings } from './i18n.js';
import { esc } from './ui.js';
import { createGhurba } from './ghurba.js';

const $ = (id) => document.getElementById(id);
const els = {
  title: $('app-title'),
  toggle: $('lang-toggle'),
  input: $('search'),
  results: $('search-results'),
  body: $('panel-body'),
  foot: $('panel-foot'),
};

// One view only: the Ghurba map of Yemenis abroad, with Yemen's governorates and districts
// merged into it. Deep links pick a place: ?gov=<slug>, &district=<id> or &city=<GeoNames id>.
const params = new URLSearchParams(location.search);
const state = { lang: 'ar' };
try {
  if (localStorage.getItem('lang') === 'en') state.lang = 'en';
} catch {}

// Weak devices and reduced-motion settings get a still globe without the glow.
const lite =
  matchMedia('(prefers-reduced-motion: reduce)').matches ||
  (navigator.deviceMemory ?? 8) <= 2 ||
  (navigator.hardwareConcurrency ?? 8) <= 2;

let data, mapApi, ghurba;
const t = (key) => strings[state.lang][key];

// Keep the globe clear of the side panel (desktop) or bottom sheet (phone).
function cameraPadding() {
  const panel = document.getElementById('panel').getBoundingClientRect();
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  const p = { top: 40, bottom: 40, left: 40, right: 40 };
  if (mobile) p.bottom += panel.height;
  else p[document.dir === 'rtl' ? 'right' : 'left'] += panel.width + 16;
  return p;
}

function renderChrome() {
  const { lang } = state;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = `${t('ghurbaTitle')} · ${t('title')}`;
  els.title.textContent = t('title');
  els.toggle.textContent = t('toggle');
  els.toggle.lang = lang === 'ar' ? 'en' : 'ar';
  const placeholder = t('ghurbaSearch');
  els.input.placeholder = placeholder;
  els.input.setAttribute('aria-label', placeholder);
  els.foot.textContent = `${t('ghurbaSources')} ${t('sources')}`;
}

// The address bar follows the view, so it can be shared: ?gov=taiz&district=YE1704&city=105343.
function syncUrl() {
  const query = ghurba.params().toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}

function setLang(lang) {
  state.lang = lang;
  try {
    localStorage.setItem('lang', lang);
  } catch {}
  renderChrome();
  ghurba.setLang(); // the globe gets new labels and padding: the panel switched sides
  mapApi.setLang(lang);
  updateResults();
}

// ---------- search ----------

let hits = [];
let active = -1;

function updateResults() {
  hits = ghurba.search(els.input.value);
  active = hits.length ? 0 : -1;
  if (!els.input.value.trim()) {
    els.results.hidden = true;
    els.input.setAttribute('aria-expanded', 'false');
    return;
  }
  els.results.innerHTML = hits.length
    ? hits
        .map((h, i) => {
          const label = ghurba.hitLabel(h);
          return `<li role="option" id="hit-${i}" data-i="${i}" aria-selected="${i === active}">
            <span>${esc(label.name)}</span><small>${esc(label.sub)}</small></li>`;
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
  ghurba.choose(h);
  els.input.value = '';
  updateResults();
  els.input.blur();
}

// ---------- boot ----------

async function init() {
  renderChrome();
  const res = await fetch(`${import.meta.env.BASE_URL}data/yemen.json`);
  data = await res.json();
  mapApi = await createMap('map', state.lang, cameraPadding(), { lite });
  ghurba = createGhurba({ state, data, mapApi, body: els.body, padding: cameraPadding, onChange: syncUrl });
  const district = params.get('district');
  const entering = ghurba.enter({
    gov: Object.values(data.governorates).find((g) => g.slug === params.get('gov'))?.id,
    district: district && data.districts[district] ? district : null,
    city: params.get('city'),
  });
  syncUrl(); // the URL now matches the view, and legacy params like ?view=ghurba drop away
  entering.catch((err) => console.error(err));

  mapApi.map.on('click', (e) => ghurba.click(mapApi.pick(e.point), e.lngLat));

  els.toggle.addEventListener('click', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));

  document.getElementById('panel').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) ghurba.panelClick(b);
  });

  // Hovering a list row highlights that place on the map.
  els.body.addEventListener('mouseover', (e) => {
    const b = e.target.closest('button[data-gov], button[data-district], button[data-city]');
    const type = b && ['gov', 'district', 'city'].find((k) => b.dataset[k]);
    mapApi.hover(b && { type, id: b.dataset[type] });
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
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (typing) return;
    if (e.key === '/') {
      e.preventDefault();
      els.input.focus();
    } else if (e.key === 'Escape') ghurba.back();
  });
}

init().catch((err) => {
  console.error(err);
  els.body.textContent = String(err);
});
