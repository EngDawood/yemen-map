// "Draw your line", in steps on the side panel while the map stays live: where you are from (the
// lists, or a click on Yemen), where you live now (a search, or a click anywhere: the nearest
// listed city, never the clicked point), how you got there (a vehicle travels the way as a
// preview) and an optional message. Only the district, the city and the message are sent, to
// POST /api/lines after a Turnstile check that stays out of sight unless Cloudflare needs a click.
// How you got there never leaves the browser.
import maplibregl from 'maplibre-gl';
import { geoDistance } from 'd3-geo';
import { strings, fmt, fill } from './i18n.js';
import { esc, crumbs } from './ui.js';
import { MODES, ICONS, journey } from './journey.js';
import { YEMEN_BOUNDS } from './map.js';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const ERRORS = { limit: 'errLimit', turnstile: 'errTurnstile', message: 'errMessage', invalid: 'errInvalid', setup: 'errSetup' };
const FLY_MS = 1900; // a camera move and a little slack (see globe.js)

const vehicleIcon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`;
const WAY_ICONS = {
  air: vehicleIcon(ICONS.air),
  car: vehicleIcon(ICONS.land),
  direct:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17Q12 3 20 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4" cy="17" r="2.2"/><circle cx="20" cy="17" r="2.2"/></svg>',
};

let turnstileReady = null;

// The Turnstile script loads only when the steps first open.
function loadTurnstile() {
  turnstileReady ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => {
      turnstileReady = null;
      reject(new Error('Turnstile did not load'));
    };
    document.head.append(script);
  });
  return turnstileReady;
}

// ctx: { state, data, mapApi, padding(), cities() (Map of id → city), searchCities(q),
//        countryName(code, lang), onAdded({ d, c, n }, mode) }
export function createAddLine(ctx) {
  const { state, data } = ctx;
  const { map, globe } = ctx.mapApi;
  // What the visitor has picked so far. It stays when the steps close, until the line is sent.
  const draft = { gov: null, district: null, city: null, mode: null, message: '' };
  let open = false;
  let form = null;
  let els = {};
  let popup = null;
  let moves = 0; // counts camera moves, so a new pick cancels the rest of an older one
  let framed = false; // whether the camera shows the whole way
  let widget = null;
  let token = null;
  let waiting = [];
  let hits = [];
  let active = -1;

  const t = (k) => strings[state.lang][k];
  const nm = (item) => item.name[state.lang];
  const byName = (a, b) => nm(a).localeCompare(nm(b), state.lang);
  const city = () => draft.city && ctx.cities().get(draft.city);
  const from = () => data.districts[draft.district].center;
  const country = (c) => ctx.countryName(c.country, state.lang);
  const showError = (text) => {
    els.error.textContent = text;
    els.error.hidden = !text;
  };

  // ---------- map ----------

  // Runs then() after the camera move that starts now, unless another move started meanwhile.
  function move(start, then) {
    const my = ++moves;
    framed = false;
    start();
    if (then) setTimeout(() => open && my === moves && then(), FLY_MS);
  }

  function frameBoth(then) {
    move(() => globe.frameLine(from(), city().center, ctx.padding()), then);
    framed = true;
  }

  // The way on the map once both ends are known: the plain line until a way to travel is
  // picked, then its vehicle travels it (animate) or it is drawn whole.
  function preview(animate = true) {
    if (!draft.district || !draft.city) return globe.clearJourney();
    const j = journey(from(), city().center, draft.mode ?? 'direct');
    globe.drawJourney(j, { animate: animate && !!draft.mode, lang: state.lang });
  }

  // Everything picked so far, shown on the map at once.
  function showPicks() {
    globe.showPicker({ gov: draft.gov, district: draft.district });
    globe.highlightGovs(draft.gov ? [draft.gov] : null);
    globe.markFrom(draft.district && from(), true);
    globe.markTo(city()?.center ?? null);
    preview(false);
  }

  // Where you live, asked from a click on the map: the nearest listed city, never the point.
  function ask(id) {
    popup?.remove();
    const c = id && ctx.cities().get(id);
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'ask';
    el.innerHTML = `<p>${esc(fill(t('askCity'), { city: nm(c), country: country(c) }))}</p>
      <button type="button" class="primary">${t('askYes')}</button>`;
    el.querySelector('button').addEventListener('click', () => {
      popup?.remove();
      pickCity(id);
    });
    popup = new maplibregl.Popup({ className: 'ask-popup', maxWidth: '260px' }).setLngLat(c.center).setDOMContent(el).addTo(map);
  }

  function nearestCity({ lng, lat }) {
    let best = null;
    let min = Infinity;
    for (const c of ctx.cities().values()) {
      const d = geoDistance([lng, lat], c.center);
      if (d < min) [best, min] = [c.id, d];
    }
    return best;
  }

  // ---------- picks ----------

  function districtOptions() {
    const g = draft.gov && data.governorates[draft.gov];
    return `<option value="">${t('pickDistrict')}</option>${
      g
        ? g.districts
            .map((id) => data.districts[id])
            .sort(byName)
            .map((d) => `<option value="${d.id}"${d.id === draft.district ? ' selected' : ''}>${esc(nm(d))}</option>`)
            .join('')
        : ''
    }`;
  }

  // The lists and step marks follow the draft.
  function syncForm() {
    els.gov.value = draft.gov ?? '';
    els.district.innerHTML = districtOptions();
    els.district.disabled = !draft.gov;
    const done = { from: !!draft.district, to: !!draft.city, how: !!draft.mode };
    for (const s of form.querySelectorAll('.step')) s.classList.toggle('done', !!done[s.dataset.step]);
  }

  // Brings the next step into view in the panel.
  const next = (step) => form.querySelector(`[data-step="${step}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  function pickGov(id) {
    draft.gov = id || null;
    if (draft.district?.slice(0, 4) !== draft.gov) draft.district = null;
    syncForm();
    showPicks();
    if (draft.gov) move(() => globe.fitArea(data.governorates[draft.gov].bbox, 8));
  }

  function pickDistrict(id) {
    draft.district = id || null;
    if (id) draft.gov = id.slice(0, 4);
    syncForm();
    showPicks();
    if (!id) return;
    if (draft.city) frameBoth(preview);
    else move(() => globe.fitArea(data.districts[id].bbox, 8.5));
    if (!draft.city) next('to');
  }

  // The camera goes to the city, a pin drops on it, then the camera pulls back to show both ends.
  function pickCity(id) {
    const c = ctx.cities().get(id);
    draft.city = id;
    els.city.value = fill(t('cityIn'), { city: nm(c), country: country(c) });
    hideResults();
    syncForm();
    popup?.remove();
    globe.clearJourney();
    globe.markTo(null);
    move(
      () => globe.flyTo(c.center, ctx.padding()),
      () => {
        globe.markTo(c.center, true);
        if (!draft.district) return;
        const my = moves;
        setTimeout(() => open && my === moves && frameBoth(preview), 600);
      },
    );
    next(draft.district ? 'how' : 'from');
  }

  function pickMode(mode) {
    draft.mode = mode;
    syncForm();
    if (!draft.district || !draft.city) return;
    if (framed) preview();
    else frameBoth(preview);
  }

  // ---------- city search ----------

  function hideResults() {
    els.results.hidden = true;
    els.city.setAttribute('aria-expanded', 'false');
    els.city.removeAttribute('aria-activedescendant');
  }

  function highlight() {
    [...els.results.querySelectorAll('[role=option]')].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) els.city.setAttribute('aria-activedescendant', `city-hit-${active}`);
  }

  function updateResults() {
    hits = ctx.searchCities(els.city.value);
    active = hits.length ? 0 : -1;
    if (!els.city.value.trim()) return hideResults();
    els.results.innerHTML = hits.length
      ? hits
          .map((h, i) => {
            const c = ctx.cities().get(h.id);
            return `<li role="option" id="city-hit-${i}" data-i="${i}" aria-selected="${i === active}">
              <span>${esc(nm(c))}</span><small>${esc(country(c))}</small></li>`;
          })
          .join('')
      : `<li class="empty">${t('noResults')}</li>`;
    els.results.hidden = false;
    els.city.setAttribute('aria-expanded', 'true');
    highlight();
  }

  function bindCitySearch() {
    const { city: input, results } = els;
    input.addEventListener('input', () => {
      // The text no longer names the chosen city.
      if (draft.city) {
        draft.city = null;
        syncForm();
        globe.markTo(null);
        preview();
      }
      updateResults();
    });
    input.addEventListener('keydown', (e) => {
      const listed = !results.hidden && hits.length;
      if (e.key === 'ArrowDown' && listed) active = (active + 1) % hits.length;
      else if (e.key === 'ArrowUp' && listed) active = (active - 1 + hits.length) % hits.length;
      else if (e.key === 'Enter') {
        e.preventDefault(); // never submits from here
        if (listed) pickCity(hits[active].id);
        return;
      } else if (e.key === 'Escape' && !results.hidden) {
        e.preventDefault(); // closes the list only
        return hideResults();
      } else return;
      e.preventDefault();
      highlight();
    });
    results.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[data-i]');
      if (li) {
        e.preventDefault();
        pickCity(hits[Number(li.dataset.i)].id);
      }
    });
    input.addEventListener('blur', hideResults);
  }

  // ---------- Turnstile ----------

  function removeCheck() {
    if (widget !== null) window.turnstile?.remove(widget);
    widget = null;
    token = null;
  }

  function renderCheck() {
    removeCheck();
    const box = form.querySelector('.turnstile');
    loadTurnstile()
      .then((turnstile) => {
        if (!open || !box.isConnected) return;
        widget = turnstile.render(box, {
          sitekey: SITE_KEY,
          language: state.lang,
          size: 'flexible',
          theme: 'light',
          appearance: 'interaction-only',
          callback: (value) => {
            token = value;
            for (const resolve of waiting.splice(0)) resolve(value);
            if (els.error.textContent === t('errCheck')) showError('');
          },
          'expired-callback': () => {
            token = null;
          },
          'error-callback': () => {
            token = null;
          },
        });
      })
      .catch(() => showError(t('errNetwork')));
  }

  // Resolves with the token once the check passes, or with null after ms.
  const waitForToken = (ms) =>
    token
      ? Promise.resolve(token)
      : new Promise((resolve) => {
          waiting.push(resolve);
          setTimeout(() => resolve(token), ms);
        });

  async function submit(e) {
    e.preventDefault();
    if (!draft.district || !draft.city) return showError(t('errPick'));
    showError('');
    const button = els.submit;
    button.disabled = true;
    button.textContent = t('sending');
    try {
      // The check runs out of sight, so give it time to finish instead of asking to wait.
      const checked = await waitForToken(30000);
      if (!checked) return showError(t('errCheck'));
      const res = await fetch('/api/lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district_id: draft.district,
          city_id: draft.city,
          message: draft.message.trim() || null,
          turnstile_token: checked,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const line = { d: draft.district, c: draft.city, n: body.n };
        const mode = draft.mode ?? 'direct';
        Object.assign(draft, { gov: null, district: null, city: null, mode: null, message: '' });
        ctx.onAdded(line, mode);
        return;
      }
      showError(t(ERRORS[body.error] ?? 'errNetwork'));
    } catch {
      showError(t('errNetwork'));
    } finally {
      button.disabled = false;
      button.textContent = t('submit');
    }
    // Tokens are single use, so any failed attempt needs a fresh check.
    token = null;
    if (widget !== null) window.turnstile?.reset(widget);
  }

  // ---------- panel ----------

  function step(n, key, label, content) {
    return `<section class="step" data-step="${key}">
      <h3 id="step-${key}"><span class="num" aria-hidden="true">${fmt(n, state.lang)}</span>${label}</h3>
      ${content}
    </section>`;
  }

  function html() {
    const c = city();
    return `
      ${crumbs([[t('ghurbaTitle'), 'data-ghome'], [t('formTitle')]])}
      <form class="add-form" novalidate>
        <h2>${t('formTitle')}</h2>
        <p class="privacy">${t('formPrivacy')}</p>
        ${step(
          1,
          'from',
          t('fromLabel'),
          `<div class="row">
            <select name="gov" aria-label="${t('pickGov')}">
              <option value="">${t('pickGov')}</option>
              ${Object.values(data.governorates)
                .sort(byName)
                .map((g) => `<option value="${g.id}">${esc(nm(g))}</option>`)
                .join('')}
            </select>
            <select name="district" aria-label="${t('pickDistrict')}"></select>
          </div>
          <small>${t('fromHelp')}</small>`,
        )}
        ${step(
          2,
          'to',
          t('toLabel'),
          `<div class="combo">
            <input id="city-input" type="search" autocomplete="off" spellcheck="false" role="combobox" aria-labelledby="step-to"
              aria-expanded="false" aria-controls="city-results" aria-autocomplete="list" placeholder="${t('cityPlaceholder')}"
              value="${c ? esc(fill(t('cityIn'), { city: nm(c), country: country(c) })) : ''}" />
            <ul id="city-results" role="listbox" hidden></ul>
          </div>
          <small>${t('toHelp')}</small>`,
        )}
        ${step(
          3,
          'how',
          t('howLabel'),
          `<div class="ways" role="radiogroup" aria-labelledby="step-how">${MODES.map(
            (m) => `<label class="way">
              <input type="radio" name="way" value="${m}"${draft.mode === m ? ' checked' : ''} />
              ${WAY_ICONS[m]}<b>${t(`way_${m}`)}</b><small>${t(`wayHelp_${m}`)}</small>
            </label>`,
          ).join('')}</div>
          <small>${t('howPrivacy')}</small>`,
        )}
        ${step(
          4,
          'message',
          t('messageLabel'),
          `<textarea id="message-input" rows="2" maxlength="80" aria-labelledby="step-message"
            placeholder="${t('messagePlaceholder')}">${esc(draft.message)}</textarea>
          <small>${t('messageHelp')}</small>`,
        )}
        <div class="turnstile"></div>
        <p class="form-error" role="alert" hidden></p>
        <button type="submit" class="primary">${t('submit')}</button>
      </form>`;
  }

  return {
    isOpen: () => open,

    // Opens on Yemen, or on what was already picked.
    open() {
      open = true;
      globe.stopSpin();
      showPicks();
      if (draft.district && draft.city) frameBoth(preview);
      else if (draft.gov) move(() => globe.fitArea(data.governorates[draft.gov].bbox, 8));
      else move(() => globe.fitArea(YEMEN_BOUNDS, 7));
    },

    close() {
      if (!open) return;
      open = false;
      moves++;
      popup?.remove();
      removeCheck();
      globe.showPicker(null);
      globe.clearJourney();
      globe.markFrom(null);
      globe.markTo(null);
    },

    // Draws the steps into the panel body (again after a language switch).
    render(body) {
      popup?.remove();
      body.innerHTML = html();
      form = body.querySelector('form');
      els = {
        gov: form.elements.gov,
        district: form.elements.district,
        city: form.querySelector('#city-input'),
        results: form.querySelector('#city-results'),
        error: form.querySelector('.form-error'),
        submit: form.querySelector('[type=submit]'),
      };
      syncForm();
      form.addEventListener('change', (e) => {
        if (e.target.name === 'gov') pickGov(e.target.value);
        else if (e.target.name === 'district') pickDistrict(e.target.value);
        else if (e.target.name === 'way') pickMode(e.target.value);
      });
      form.querySelector('#message-input').addEventListener('input', (e) => (draft.message = e.target.value));
      form.addEventListener('submit', submit);
      bindCitySearch();
      renderCheck();
    },

    // A click on the map picks instead of exploring: in Yemen the governorate, then the
    // district; anywhere else the nearest listed city, after asking.
    mapClick(hit, lngLat) {
      if (hit?.type === 'district') pickDistrict(hit.id);
      else if (hit?.type === 'gov') pickGov(hit.id);
      else ask(hit?.type === 'city' ? hit.id : nearestCity(lngLat));
    },

    // A pick from the search box at the top of the panel.
    searchPick(hit) {
      if (hit.type === 'gov') pickGov(hit.id);
      else if (hit.type === 'district') pickDistrict(hit.id);
      else if (hit.type === 'city') pickCity(hit.id);
    },

    // Escape: closes the question on the map, if one is open.
    back() {
      if (!popup?.isOpen()) return false;
      popup.remove();
      return true;
    },
  };
}
