// API for the Ghurba map. Static files (the app itself) are served by Workers Static Assets
// before this code runs, so only /api/* and unknown paths reach it.
//   GET  /api/lines              aggregated counts and approved messages, cached for a minute
//   POST /api/lines              add a line; answers "you are one of N"
//   GET  /api/admin/lines        moderation list (Bearer ADMIN_TOKEN)
//   POST /api/admin/lines/:id    hide or show a line, approve or reject its message
import yemen from '../public/data/yemen.json';
import cities from '../public/data/cities.json';

const DISTRICTS = new Set(Object.keys(yemen.districts));
const CITIES = new Set(cities.map((c) => c.id));

const DAY = 24 * 60 * 60 * 1000;
const MESSAGE_MAX = 80; // characters
const LINES_TTL = 60; // seconds

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/lines') {
        if (request.method === 'GET') return await getLines(request, env, ctx);
        if (request.method === 'POST') return await addLine(request, env, ctx);
        return json({ error: 'method' }, 405, { Allow: 'GET, POST' });
      }
      if (url.pathname.startsWith('/api/admin/')) return await admin(request, env, ctx, url);
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error(JSON.stringify({ message: 'request failed', path: url.pathname, error: String(err?.stack ?? err) }));
      return json({ error: 'server' }, 500);
    }
  },

  // Daily cron: device hashes are only kept for 30 days.
  async scheduled(controller, env) {
    await env.DB.prepare('UPDATE lines SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?1')
      .bind(Date.now() - 30 * DAY)
      .run();
  },
};

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

// Parses a small JSON body; null when it is missing, too large or not JSON.
async function readJson(request, limit) {
  const length = Number(request.headers.get('content-length'));
  if (!length || length > limit) return null;
  try {
    return JSON.parse(await request.text());
  } catch {
    return null;
  }
}

// ---------- public counts ----------

// The public counts are cached for a minute in this isolate (works on workers.dev) and in the
// data center's cache (works on custom domains), so D1 is not queried on every visit. It holds
// only aggregated public data, never anything from a request.
let memo = null;

// One cache entry whatever the query string, so cache-busting URLs cannot reach D1.
const linesKey = (request) => new Request(new URL('/api/lines', request.url));

// After a change, drop both caches here so the next visit from this data center sees it.
function forgetLines(request, ctx) {
  memo = null;
  ctx.waitUntil(caches.default.delete(linesKey(request)));
}

async function getLines(request, env, ctx) {
  const now = Date.now();
  const headers = { 'Cache-Control': `public, max-age=${LINES_TTL}` };
  if (memo && now - memo.at < LINES_TTL * 1000) return json(memo.body, 200, headers);

  const key = linesKey(request);
  const hit = await caches.default.match(key);
  if (hit) return hit;

  const [lines, messages] = await env.DB.batch([
    env.DB.prepare(
      "SELECT district_id AS d, city_id AS c, COUNT(*) AS n FROM lines WHERE status = 'ok' GROUP BY city_id, district_id",
    ),
    // Messages carry the governorate only, not the district.
    env.DB.prepare(
      "SELECT substr(district_id, 1, 4) AS g, city_id AS c, message AS m FROM lines WHERE status = 'ok' AND message_status = 'approved' ORDER BY created_at DESC LIMIT 200",
    ),
  ]);
  const body = { lines: lines.results, messages: messages.results };
  memo = { at: now, body };
  const res = json(body, 200, headers);
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

// ---------- new line ----------

async function addLine(request, env, ctx) {
  if (!env.TURNSTILE_SECRET || !env.HASH_SALT) {
    console.error(JSON.stringify({ message: 'TURNSTILE_SECRET or HASH_SALT is not set' }));
    return json({ error: 'setup' }, 503);
  }
  const body = await readJson(request, 4096);
  const district = String(body?.district_id ?? '');
  const city = String(body?.city_id ?? '');
  if (!DISTRICTS.has(district) || !CITIES.has(city)) return json({ error: 'invalid' }, 400);
  const message = cleanMessage(body.message);
  if (message === false) return json({ error: 'message' }, 400);

  const ip = request.headers.get('cf-connecting-ip') ?? '';
  if (!(await verifyTurnstile(env, body.turnstile_token, ip))) return json({ error: 'turnstile' }, 403);

  const hash = await deviceHash(env, ip, request.headers.get('user-agent') ?? '');
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT 1 FROM lines WHERE ip_hash = ?1 AND created_at > ?2 LIMIT 1')
    .bind(hash, now - DAY)
    .first();
  if (recent) return json({ error: 'limit' }, 429);

  // District ids start with their governorate's id (YE1704 is in YE17), so a range covers it.
  const gov = district.slice(0, 4);
  const [, count] = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO lines (district_id, city_id, created_at, ip_hash, message, message_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    ).bind(district, city, now, hash, message, message ? 'pending' : null),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM lines WHERE status = 'ok' AND city_id = ?1 AND district_id >= ?2 AND district_id < ?3",
    ).bind(city, gov, `${gov}~`),
  ]);
  forgetLines(request, ctx);
  return json({ n: count.results[0].n }, 201);
}

// The cleaned message, null when there is none, or false when it cannot be accepted.
function cleanMessage(value) {
  if (value == null) return null;
  const text = String(value)
    // Control characters and direction overrides, which could disguise the text.
    .replace(/[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if ([...text].length > MESSAGE_MAX) return false;
  if (/https?:|www\./i.test(text)) return false;
  return text;
}

async function verifyTurnstile(env, token, ip) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!res.ok) return false;
  const outcome = await res.json();
  return outcome.success === true;
}

// A keyed hash of IP and browser: enough to allow one line per device per day, useless for
// finding anyone without the secret, and cleared after 30 days by the cron job.
async function deviceHash(env, ip, userAgent) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.HASH_SALT), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ip}\n${userAgent}`));
  return [...new Uint8Array(sig, 0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- moderation ----------

const ADMIN_VIEWS = {
  pending: "message_status = 'pending'",
  hidden: "status = 'hidden'",
  all: '1 = 1',
};
const ADMIN_COLUMNS =
  'id, district_id, city_id, created_at, status, message, message_status, substr(ip_hash, 1, 8) AS device';

async function admin(request, env, ctx, url) {
  if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401);

  if (url.pathname === '/api/admin/lines' && request.method === 'GET') {
    const view = url.searchParams.get('view');
    const where = Object.hasOwn(ADMIN_VIEWS, view) ? ADMIN_VIEWS[view] : ADMIN_VIEWS.all;
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
    const { results } = await env.DB.prepare(
      `SELECT ${ADMIN_COLUMNS} FROM lines WHERE ${where} AND id < ?1 ORDER BY id DESC LIMIT 50`,
    )
      .bind(before)
      .all();
    return json({ lines: results });
  }

  const id = Number(url.pathname.match(/^\/api\/admin\/lines\/(\d+)$/)?.[1]);
  if (id && request.method === 'POST') {
    const body = await readJson(request, 1024);
    const updates = [];
    if (body?.status === 'ok' || body?.status === 'hidden') {
      updates.push(env.DB.prepare('UPDATE lines SET status = ?1 WHERE id = ?2').bind(body.status, id));
    }
    if (body?.message_status === 'approved') {
      updates.push(
        env.DB.prepare("UPDATE lines SET message_status = 'approved' WHERE id = ?1 AND message IS NOT NULL").bind(id),
      );
    } else if (body?.message_status === 'rejected') {
      // Rejected text is not kept.
      updates.push(env.DB.prepare("UPDATE lines SET message_status = 'rejected', message = NULL WHERE id = ?1").bind(id));
    }
    if (!updates.length) return json({ error: 'invalid' }, 400);
    await env.DB.batch(updates);
    forgetLines(request, ctx);
    const line = await env.DB.prepare(`SELECT ${ADMIN_COLUMNS} FROM lines WHERE id = ?1`).bind(id).first();
    return line ? json({ line }) : json({ error: 'not_found' }, 404);
  }

  return json({ error: 'not_found' }, 404);
}

async function authorized(request, env) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !env.ADMIN_TOKEN) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(token)),
    crypto.subtle.digest('SHA-256', enc.encode(env.ADMIN_TOKEN)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}
