// Moderation page (/admin.html): approve or reject messages, hide spam lines.
// Talks to /api/admin/* with the ADMIN_TOKEN secret, kept only for this browser tab.
import '@dawod/thmanyah-font-web/sans.css';
import './admin.css';
import { esc } from './ui.js';
import { countryName } from './countries.js';

const KEY = 'ghurba-admin-token';
const PAGE = 50;
const $ = (id) => document.getElementById(id);
const date = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' });
const MESSAGE_STATUS = { approved: 'منشورة', rejected: 'مرفوضة', pending: 'بانتظار المراجعة' };

let token = '';
try {
  token = sessionStorage.getItem(KEY) ?? '';
} catch {}
let view = 'pending';
let rows = [];
let names = null;

async function loadNames() {
  const [yemen, cities] = await Promise.all(
    ['yemen.json', 'cities.json'].map((f) => fetch(`${import.meta.env.BASE_URL}data/${f}`).then((r) => r.json())),
  );
  return { yemen, cities: new Map(cities.map((c) => [c.id, c])) };
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401) {
    logout('الرمز غير صحيح.');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function where(r) {
  const d = names.yemen.districts[r.district_id];
  const g = d && names.yemen.governorates[d.gov];
  const c = names.cities.get(r.city_id);
  return `من <b>${esc(d?.name.ar ?? r.district_id)}</b> (${esc(g?.name.ar ?? '')}) إلى <b>${esc(c?.name.ar ?? r.city_id)}</b>، ${esc(c ? countryName(c.country, 'ar') : '')}`;
}

function row(r) {
  const message = r.message ? `<p class="msg">${esc(r.message)}</p>` : '';
  const review =
    r.message_status === 'pending'
      ? `<button type="button" data-id="${r.id}" data-message="approved">نشر الرسالة</button>
         <button type="button" data-id="${r.id}" data-message="rejected">رفض الرسالة</button>`
      : r.message_status
        ? `<span class="tag">${MESSAGE_STATUS[r.message_status]}</span>`
        : '';
  const visibility =
    r.status === 'hidden'
      ? `<button type="button" data-id="${r.id}" data-status="ok">إظهار الخط</button>`
      : `<button type="button" data-id="${r.id}" data-status="hidden">إخفاء الخط</button>`;
  return `<li class="${r.status === 'hidden' ? 'is-hidden' : ''}">
    <div>${where(r)}</div>
    <div class="muted">#${r.id} · ${date.format(r.created_at)} · جهاز ${esc(r.device ?? '—')}</div>
    ${message}
    <div class="actions">${review}${visibility}</div>
  </li>`;
}

function render(more) {
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === view));
  $('rows').innerHTML = rows.map(row).join('');
  $('empty').hidden = rows.length > 0;
  $('more').hidden = !more;
}

async function list(append = false) {
  const before = append && rows.length ? rows.at(-1).id : '';
  const { lines } = await api(`/api/admin/lines?view=${view}&before=${before}`);
  rows = append ? [...rows, ...lines] : lines;
  render(lines.length === PAGE);
}

async function update(id, change) {
  const { line } = await api(`/api/admin/lines/${id}`, change);
  rows = rows.map((r) => (r.id === id ? line : r));
  if (view === 'pending' && line.message_status !== 'pending') rows = rows.filter((r) => r.id !== id);
  if (view === 'hidden' && line.status !== 'hidden') rows = rows.filter((r) => r.id !== id);
  render(!$('more').hidden);
}

function logout(message = '') {
  token = '';
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  $('admin').hidden = true;
  $('logout').hidden = true;
  $('login').hidden = false;
  const error = $('login').querySelector('.error');
  error.textContent = message;
  error.hidden = !message;
}

async function start() {
  names ??= await loadNames();
  $('login').hidden = true;
  $('admin').hidden = false;
  $('logout').hidden = false;
  await list();
}

$('login').addEventListener('submit', (e) => {
  e.preventDefault();
  token = $('token').value.trim();
  try {
    sessionStorage.setItem(KEY, token);
  } catch {}
  start().catch((err) => console.error(err));
});
$('logout').addEventListener('click', () => logout());
$('more').addEventListener('click', () => list(true).catch((err) => console.error(err)));
document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  view = b.dataset.view;
  list().catch((err) => console.error(err));
});
$('rows').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  const change = b.dataset.message ? { message_status: b.dataset.message } : { status: b.dataset.status };
  b.disabled = true;
  update(Number(b.dataset.id), change).catch((err) => {
    b.disabled = false;
    console.error(err);
  });
});

if (token) start().catch((err) => console.error(err));
