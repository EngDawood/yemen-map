// Journeys for "draw your line": the way from a district to a city, split into land and sea legs
// so a car becomes a ship where the way crosses water. The way is the great circle itself, tested
// against the Natural Earth land the globe already draws. No routing service and no server: the
// point is the story, not directions.
import { geoDistance, geoInterpolate } from 'd3-geo';

// air: a plane on the arc; car: by land, by ship where the way crosses water; direct: the plain line.
export const MODES = ['air', 'car', 'direct'];

// How each kind of leg looks, on the globe and on the card.
export const COLORS = { air: '#ffffff', land: '#ffb300', sea: '#4fc3f7', direct: '#ffffff' };

// Vehicle silhouettes on a 24 × 24 grid, filled with the even-odd rule: the plane points up, the
// car and the ship face right.
export const ICONS = {
  air: 'M12 1.5C12.9 1.5 13.5 2.6 13.5 3.8V9L22 13.5V15.5L13.5 13V18.5L16.5 20.5V22L12 21L7.5 22V20.5L10.5 18.5V13L2 15.5V13.5L10.5 9V3.8C10.5 2.6 11.1 1.5 12 1.5Z',
  land:
    'M2 16.5V12.6C2 11.8 2.5 11.2 3.3 11L6.2 10.3L8.3 6.9C8.6 6.3 9.1 6 9.7 6H14.6C15.2 6 15.7 6.3 16.1 6.8L18.9 10.3L20.8 10.9C21.6 11.1 22 11.7 22 12.5V16.5H20A3 3 0 0 0 14 16.5H10A3 3 0 0 0 4 16.5Z' +
    'M9.6 7.3H11.6V9.9H7.9ZM12.6 7.3H14.5L16.6 9.9H12.6Z' +
    'M9.2 16.5A2.2 2.2 0 1 1 4.8 16.5A2.2 2.2 0 1 1 9.2 16.5ZM19.2 16.5A2.2 2.2 0 1 1 14.8 16.5A2.2 2.2 0 1 1 19.2 16.5Z',
  sea: 'M4.5 19.5L2 13.5H4V9H5V6.5H6.5V3.8H8.3V6.5H9.5V9H10.5V11H18.5V13.5H22.5L19 19.5ZM5.8 7.3H8.8V8.3H5.8Z',
};

const EARTH_KM = 6371;
const STEP = (0.2 * Math.PI) / 180; // a point about every 22 km
// Stretches of land or sea shorter than this join their neighbors, so the vehicle does not blink
// at every small island or bay: at least 50 km, and 8% of the way, which keeps each leg on screen
// long enough to see. At the two ends only a single point of coastline is dropped, so a trip
// still starts and ends the way it really does.
const MIN_LEG_KM = 50;
const MIN_LEG_SHARE = 0.08;
const MIN_END_KM = 25;

// Fetched once and shared by the globe, the journeys and the share card; a failed load is retried.
function loader(file) {
  let req = null;
  return () =>
    (req ??= fetch(`${import.meta.env.BASE_URL}data/${file}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${file}`))))
      .catch((err) => {
        req = null;
        throw err;
      }));
}
export const loadLand = loader('land.geojson');
const loadSeas = loader('seas.geojson');

let land = null;
let seas = null;

// Without the land a car stays on the road all the way; without the seas no sea is named.
export async function loadJourneys() {
  const [l, s] = await Promise.allSettled([loadLand(), loadSeas()]);
  if (l.status === 'fulfilled') land ??= polygons(l.value.geometries.map((geometry) => ({ geometry })));
  if (s.status === 'fulfilled') seas ??= polygons(s.value.features.map((f) => ({ geometry: f.geometry, value: f.properties })));
  for (const r of [l, s]) if (r.status === 'rejected') console.warn('Journey data unavailable.', r.reason);
}

// Each polygon as flat rings ([x0, y0, x1, y1, …]) with its bounding box, so most point tests
// stop at the box and the rest run fast.
function polygons(items) {
  const list = [];
  for (const { geometry, value } of items) {
    for (const rings of geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) {
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of rings[0]) {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
      list.push({ rings: rings.map((ring) => Float64Array.from(ring.flat())), value, box });
    }
  }
  return list;
}

// Even-odd ray casting, so holes need no special care. Plain longitude and latitude are fine:
// Natural Earth already cuts its shapes at the antimeridian.
function inside({ rings, box }, [x, y]) {
  if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) return false;
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1];
      const yj = r[j + 1];
      if (yi > y !== yj > y && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]) hit = !hit;
    }
  }
  return hit;
}

const onLand = (p) => !land || land.some((poly) => inside(poly, p));

// The { ar, en } name of the sea most of these points are in, or null.
function seaAt(points) {
  if (!seas) return null;
  const votes = new Map();
  for (const p of points) {
    const sea = seas.find((poly) => inside(poly, p))?.value;
    if (sea) votes.set(sea, (votes.get(sea) ?? 0) + 1);
  }
  return [...votes].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
}

// The way from a to b ([lon, lat]) by mode, as { mode, km, legs }. Each leg is
// { kind: 'air' | 'land' | 'sea' | 'direct', coords, km } plus, at sea, the sea's name. Legs share
// their end points, so together they draw one unbroken line.
export function journey(a, b, mode) {
  const angle = geoDistance(a, b);
  const km = angle * EARTH_KM;
  const n = Math.max(2, Math.ceil(angle / STEP));
  const at = geoInterpolate(a, b);
  const coords = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? a : i === n ? b : at(i / n)));
  if (mode !== 'car') return { mode, km, legs: [{ kind: mode === 'air' ? 'air' : 'direct', coords, km }] };

  // Runs of points on land or at sea; each point stands for one step of the way.
  const runs = [];
  coords.forEach((p, i) => {
    const kind = onLand(p) ? 'land' : 'sea';
    if (runs.at(-1)?.kind === kind) runs.at(-1).end = i;
    else runs.push({ kind, start: i, end: i });
  });
  // The shortest run that is too short joins its neighbors (always of the other kind), until none is left.
  const stepKm = km / n;
  const length = (r) => (r.end - r.start + 1) * stepKm;
  const min = Math.max(MIN_LEG_KM, MIN_LEG_SHARE * km);
  const tooShort = (r, i) => length(r) < (i === 0 || i === runs.length - 1 ? MIN_END_KM : min);
  while (runs.length > 1) {
    let k = -1;
    runs.forEach((r, i) => {
      if (tooShort(r, i) && (k < 0 || length(r) < length(runs[k]))) k = i;
    });
    if (k < 0) break;
    const prev = runs[k - 1];
    const next = runs[k + 1];
    if (prev) prev.end = next ? next.end : runs[k].end;
    else next.start = runs[k].start;
    runs.splice(k, prev && next ? 2 : 1);
  }

  const legs = runs.map((r, i) => {
    const part = coords.slice(r.start, (runs[i + 1]?.start ?? r.end) + 1);
    const leg = { kind: r.kind, coords: part, km: (part.length - 1) * stepKm };
    // Named where the ship sets out: the sea most of the leg's first fifth crosses.
    if (r.kind === 'sea') leg.sea = seaAt(part.slice(0, Math.max(3, Math.ceil(part.length / 5))));
    return leg;
  });
  return { mode, km, legs };
}
