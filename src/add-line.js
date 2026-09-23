// The "draw your line" dialog: district, city and an optional message, checked by Turnstile,
// then sent to POST /api/lines. Nothing else about the visitor is asked for or sent.
import { strings } from './i18n.js';
import { esc } from './ui.js';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const ERRORS = { limit: 'errLimit', turnstile: 'errTurnstile', message: 'errMessage', invalid: 'errInvalid', setup: 'errSetup' };

let turnstileReady = null;
let widget = null;

export const addLineOpen = () => !!document.getElementById('add-dialog')?.open;

export function closeAddLine() {
  const dialog = document.getElementById('add-dialog');
  if (dialog?.open) dialog.close();
}

// The Turnstile script loads only when the dialog first opens.
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

// opts: { lang, data, cities (Map), searchCities(q), countryName(code, lang), onAdded({ d, c, n }) }
export function openAddLine(opts) {
  const { lang, data, cities } = opts;
  const t = (k) => strings[lang][k];
  const name = (item) => item.name[lang];
  const byName = (a, b) => name(a).localeCompare(name(b), lang);
  const dialog = document.getElementById('add-dialog');

  dialog.innerHTML = `
    <form class="add-form" novalidate>
      <header>
        <h2>${t('formTitle')}</h2>
        <button type="button" class="close" data-close aria-label="${t('close')}">×</button>
      </header>
      <p class="privacy">${t('formPrivacy')}</p>
      <fieldset>
        <legend>${t('fromLabel')}</legend>
        <div class="row">
          <select name="gov" aria-label="${t('pickGov')}">
            <option value="">${t('pickGov')}</option>
            ${Object.values(data.governorates)
              .sort(byName)
              .map((g) => `<option value="${g.id}">${esc(name(g))}</option>`)
              .join('')}
          </select>
          <select name="district" aria-label="${t('pickDistrict')}" disabled>
            <option value="">${t('pickDistrict')}</option>
          </select>
        </div>
      </fieldset>
      <div class="field">
        <label for="city-input">${t('toLabel')}</label>
        <div class="combo">
          <input id="city-input" type="search" autocomplete="off" spellcheck="false" role="combobox"
            aria-expanded="false" aria-controls="city-results" aria-autocomplete="list" placeholder="${t('cityPlaceholder')}" />
          <ul id="city-results" role="listbox" hidden></ul>
        </div>
        <small>${t('cityHelp')}</small>
      </div>
      <div class="field">
        <label for="message-input">${t('messageLabel')}</label>
        <textarea id="message-input" rows="2" maxlength="80" placeholder="${t('messagePlaceholder')}"></textarea>
        <small>${t('messageHelp')}</small>
      </div>
      <div class="turnstile"></div>
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="primary">${t('submit')}</button>
    </form>`;

  const form = dialog.querySelector('form');
  const [gov, district] = form.querySelectorAll('select');
  const input = form.querySelector('#city-input');
  const results = form.querySelector('#city-results');
  const message = form.querySelector('#message-input');
  const error = form.querySelector('.form-error');
  const submit = form.querySelector('[type=submit]');
  let token = null;
  let cityId = null;
  let hits = [];
  let active = -1;

  const showError = (text) => {
    error.textContent = text;
    error.hidden = !text;
  };

  gov.addEventListener('change', () => {
    const g = data.governorates[gov.value];
    district.innerHTML = `<option value="">${t('pickDistrict')}</option>${
      g
        ? g.districts
            .map((id) => data.districts[id])
            .sort(byName)
            .map((d) => `<option value="${d.id}">${esc(name(d))}</option>`)
            .join('')
        : ''
    }`;
    district.disabled = !g;
  });

  // ---------- city combobox ----------

  const hideResults = () => {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  function highlight() {
    [...results.querySelectorAll('[role=option]')].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) input.setAttribute('aria-activedescendant', `city-hit-${active}`);
  }

  function update() {
    hits = opts.searchCities(input.value);
    active = hits.length ? 0 : -1;
    if (!input.value.trim()) return hideResults();
    results.innerHTML = hits.length
      ? hits
          .map((h, i) => {
            const c = cities.get(h.id);
            return `<li role="option" id="city-hit-${i}" data-i="${i}" aria-selected="${i === active}">
              <span>${esc(name(c))}</span><small>${esc(opts.countryName(c.country, lang))}</small></li>`;
          })
          .join('')
      : `<li class="empty">${t('noResults')}</li>`;
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight();
  }

  function choose(i) {
    const h = hits[i];
    if (!h) return;
    const c = cities.get(h.id);
    cityId = h.id;
    input.value = `${name(c)}، ${opts.countryName(c.country, lang)}`;
    hideResults();
  }

  input.addEventListener('input', () => {
    cityId = null;
    update();
  });
  input.addEventListener('keydown', (e) => {
    const open = !results.hidden && hits.length;
    if (e.key === 'ArrowDown' && open) active = (active + 1) % hits.length;
    else if (e.key === 'ArrowUp' && open) active = (active - 1 + hits.length) % hits.length;
    else if (e.key === 'Enter') {
      e.preventDefault(); // never submits from here
      if (open) choose(active);
      return;
    } else if (e.key === 'Escape' && !results.hidden) {
      e.preventDefault(); // closes the list, not the dialog
      return hideResults();
    } else return;
    e.preventDefault();
    highlight();
  });
  results.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) {
      e.preventDefault();
      choose(Number(li.dataset.i));
    }
  });
  input.addEventListener('blur', hideResults);

  // ---------- Turnstile ----------

  const box = form.querySelector('.turnstile');
  function resetCheck() {
    token = null;
    if (widget !== null) window.turnstile?.reset(widget);
  }
  loadTurnstile()
    .then((turnstile) => {
      if (!dialog.open) return;
      widget = turnstile.render(box, {
        sitekey: SITE_KEY,
        language: lang,
        size: 'flexible',
        theme: 'light',
        callback: (value) => {
          token = value;
          if (error.textContent === t('errCheck')) showError('');
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

  // ---------- submit ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!district.value || !cityId) return showError(t('errPick'));
    if (!token) return showError(t('errCheck'));
    showError('');
    submit.disabled = true;
    submit.textContent = t('sending');
    try {
      const res = await fetch('/api/lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district_id: district.value,
          city_id: cityId,
          message: message.value.trim() || null,
          turnstile_token: token,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const line = { d: district.value, c: cityId, n: body.n };
        dialog.close();
        opts.onAdded(line);
        return;
      }
      showError(t(ERRORS[body.error] ?? 'errNetwork'));
    } catch {
      showError(t('errNetwork'));
    } finally {
      submit.disabled = false;
      submit.textContent = t('submit');
    }
    // Tokens are single use, so any failed attempt needs a fresh check.
    resetCheck();
  });

  form.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener(
    'close',
    () => {
      if (widget !== null) window.turnstile?.remove(widget);
      widget = null;
      opts.onClose?.();
    },
    { once: true },
  );
  // A click on the backdrop closes the dialog. (No expression body: returning false would cancel every click.)
  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.close();
  };

  dialog.showModal();
  gov.focus();
}
