// Ghurba mode on the map: a globe with a great-circle line from each district to each city.
// The layers live in the map style from the start (hidden), so switching modes only toggles
// visibility, projection and bounds.
import maplibregl from 'maplibre-gl';
import { geoDistance, geoInterpolate } from 'd3-geo';
import { COLORS, ICONS } from './journey.js';

const color = {
  ocean: '#0b1a2e',
  land: '#1c2e46',
  yemen: '#d9a441',
  yemenHover: '#f0c46a',
  yemenDim: '#6b5634',
  yemenLine: '#0b1a2e',
  picked: '#fff1cf',
  pickText: '#2b1d05',
  pickHalo: 'rgba(255, 240, 205, 0.85)',
  line: '#ffc65c',
  glow: '#ff9a2e',
  mine: '#ffffff',
  city: '#ffd88a',
  label: '#f4e8cf',
  halo: '#0b1a2e',
};

const empty = { type: 'FeatureCollection', features: [] };

export const ghurbaSources = {
  'g-land': { type: 'geojson', data: empty, attribution: 'Natural Earth · GeoNames' },
  'g-lines': { type: 'geojson', data: empty },
  'g-cities': { type: 'geojson', data: empty, promoteId: 'id' },
  'g-mine': { type: 'geojson', data: empty },
};

const hidden = { visibility: 'none' };
// The picking layers of "draw your line" show nothing until a governorate is chosen.
const noGov = ['==', ['get', 'gov'], ''];
const noLabels = ['==', ['get', 'id'], ''];
const kindColor = ['match', ['get', 'kind'], 'air', COLORS.air, 'land', COLORS.land, 'sea', COLORS.sea, COLORS.direct];
const pickText = { 'text-color': color.pickText, 'text-halo-color': color.pickHalo, 'text-halo-width': 1.4 };

// Line width grows with the number of people on that district-to-city pair, and with zoom.
const width = (k) => {
  const byCount = (z) => ['interpolate', ['linear'], ['get', 'n'], 1, 0.7 * k * z, 10, 1.4 * k * z, 100, 2.6 * k * z, 1000, 4.5 * k * z];
  return ['interpolate', ['linear'], ['zoom'], 1, byCount(1), 5, byCount(1.8)];
};

// Drawn under everything else.
export const ghurbaBottomLayers = [
  { id: 'g-ocean', type: 'background', layout: hidden, paint: { 'background-color': color.ocean } },
  { id: 'g-land', type: 'fill', source: 'g-land', layout: hidden, paint: { 'fill-color': color.land } },
];

// Drawn over everything else.
export const ghurbaTopLayers = [
  // The chosen governorate's districts, to pick one from.
  {
    id: 'g-districts',
    type: 'fill',
    source: 'districts',
    filter: noGov,
    layout: hidden,
    paint: {
      'fill-color': [
        'case',
        ['boolean', ['feature-state', 'picked'], false],
        color.picked,
        ['boolean', ['feature-state', 'hover'], false],
        color.yemenHover,
        'rgba(0, 0, 0, 0)',
      ],
    },
  },
  {
    id: 'g-district-lines',
    type: 'line',
    source: 'districts',
    filter: noGov,
    layout: hidden,
    paint: { 'line-color': color.yemenLine, 'line-width': 0.8, 'line-opacity': 0.6 },
  },
  {
    id: 'g-glow',
    type: 'line',
    source: 'g-lines',
    layout: { ...hidden, 'line-cap': 'round' },
    paint: { 'line-color': color.glow, 'line-opacity': 0.3, 'line-blur': 3, 'line-width': width(4) },
  },
  {
    id: 'g-lines',
    type: 'line',
    source: 'g-lines',
    layout: { ...hidden, 'line-cap': 'round' },
    paint: { 'line-color': color.line, 'line-opacity': 0.85, 'line-width': width(1) },
  },
  // The visitor's own journey, one feature per leg (see journey.js): the plain line glows, the
  // road is solid, the air and the sea are dashed.
  {
    id: 'g-mine-glow',
    type: 'line',
    source: 'g-mine',
    filter: ['==', ['get', 'kind'], 'direct'],
    layout: { ...hidden, 'line-cap': 'round' },
    paint: { 'line-color': color.mine, 'line-opacity': 0.35, 'line-blur': 4, 'line-width': 9 },
  },
  {
    id: 'g-mine-casing',
    type: 'line',
    source: 'g-mine',
    filter: ['!=', ['get', 'kind'], 'direct'],
    layout: { ...hidden, 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color.ocean, 'line-opacity': 0.55, 'line-width': 7 },
  },
  {
    id: 'g-mine',
    type: 'line',
    source: 'g-mine',
    filter: ['in', ['get', 'kind'], ['literal', ['direct', 'land']]],
    layout: { ...hidden, 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': kindColor, 'line-width': ['match', ['get', 'kind'], 'land', 3.5, 2.5] },
  },
  {
    id: 'g-mine-dash',
    type: 'line',
    source: 'g-mine',
    filter: ['in', ['get', 'kind'], ['literal', ['air', 'sea']]],
    layout: { ...hidden, 'line-join': 'round' },
    paint: { 'line-color': kindColor, 'line-width': 3, 'line-dasharray': [2, 1.6] },
  },
  {
    id: 'g-cities',
    type: 'circle',
    source: 'g-cities',
    layout: hidden,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 1, 2.5, 10, 6, 40, 14],
      'circle-color': color.city,
      'circle-opacity': 0.9,
      'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], color.mine, color.ocean],
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 1],
      // Dots on the far side of the globe stay hidden.
      'circle-pitch-alignment': 'map',
    },
  },
  {
    id: 'g-city-labels',
    type: 'symbol',
    source: 'g-cities',
    minzoom: 2.5,
    layout: {
      ...hidden,
      'text-field': ['get', 'ar'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-optional': true,
      'symbol-sort-key': ['-', ['get', 'n']],
    },
    paint: { 'text-color': color.label, 'text-halo-color': color.halo, 'text-halo-width': 1.2 },
  },
  // Names to pick by: the governorates (but the chosen one), then the chosen one's districts.
  {
    id: 'g-gov-labels',
    type: 'symbol',
    source: 'gov-labels',
    minzoom: 4,
    filter: noLabels,
    layout: { ...hidden, 'text-field': ['get', 'ar'], 'text-font': ['Noto Sans Medium'], 'text-size': 13, 'text-max-width': 8 },
    paint: pickText,
  },
  {
    id: 'g-district-labels',
    type: 'symbol',
    source: 'district-labels',
    minzoom: 6,
    filter: noGov,
    layout: { ...hidden, 'text-field': ['get', 'ar'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 7 },
    paint: pickText,
  },
];

const GHURBA_IDS = new Set([...ghurbaBottomLayers, ...ghurbaTopLayers].map((l) => l.id));
// Yemen's governorates stay on the globe as the place every line starts from.
const SHARED_IDS = new Set(['gov-fill', 'gov-line']);
const LABEL_IDS = ['g-city-labels', 'g-gov-labels', 'g-district-labels'];

// A LineString, or a MultiLineString split where the points cross the antimeridian, so the map
// does not draw them the long way round.
export function lineGeometry(points) {
  const parts = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const p = points[i];
    if (Math.abs(p[0] - prev[0]) > 180) {
      const side = prev[0] > 0 ? 180 : -180;
      const t = (side - prev[0]) / (p[0] + 2 * side - prev[0]);
      const lat = prev[1] + t * (p[1] - prev[1]);
      parts.at(-1).push([side, lat]);
      parts.push([[-side, lat]]);
    }
    parts.at(-1).push(p);
  }
  return parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
}

// Great-circle points from a to b ([lon, lat]).
export function greatCircle(a, b) {
  const steps = Math.max(8, Math.ceil((geoDistance(a, b) * 180) / Math.PI / 1.5));
  const at = geoInterpolate(a, b);
  return lineGeometry(Array.from({ length: steps + 1 }, (_, i) => (i ? at(i / steps) : a)));
}

const legFeature = (kind, coords) => ({ type: 'Feature', properties: { kind }, geometry: lineGeometry(coords) });

// 3 to 8 seconds by distance, the plane clearly faster; the plain line draws in two.
function tripSeconds(j) {
  if (j.mode === 'direct') return 2;
  const road = 4 + 4 * Math.min(1, j.km / 10000);
  return j.mode === 'air' ? Math.max(3, 0.6 * road) : road;
}

const easeInOut = (t) => (1 - Math.cos(Math.PI * t)) / 2;
const easeOut = (t) => 1 - (1 - t) ** 3;

// Restarts a CSS animation that is keyed on a class.
function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function vehicleElement() {
  const el = document.createElement('div');
  el.className = 'vehicle';
  el.innerHTML = `<span class="sea-name"></span><span class="badge">${Object.entries(ICONS)
    .map(([kind, d]) => `<svg class="icon" data-kind="${kind}" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`)
    .join('')}</span>`;
  return el;
}

export function createGlobe(map, { maxBounds, lite }) {
  let saved = null; // Yemen-mode visibility and paint, restored on leave
  let spinning = false;
  let frame = 0;
  let last = 0;
  let idle = 0;
  let trip = 0; // animation frame of the journey being drawn
  let arrival = 0;
  let vehicle = null;
  let picked = null; // district lit while picking
  const ends = { from: null, to: null };

  const layers = () => map.getStyle().layers;
  const show = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');

  function tick(time) {
    if (!spinning) return;
    const dt = last ? Math.min(time - last, 100) : 16;
    last = time;
    const c = map.getCenter();
    map.jumpTo({ center: [c.lng - dt * 0.004, c.lat] }); // about 4° a second, west to east like the Earth
    frame = requestAnimationFrame(tick);
  }

  function stopTrip() {
    cancelAnimationFrame(trip);
    clearTimeout(arrival);
    vehicle?.remove();
    vehicle = null;
  }

  // A marker at one end of the visitor's line, with an optional effect class (pulse, drop).
  function mark(end, lngLat, effect) {
    ends[end]?.remove();
    ends[end] = null;
    if (!lngLat) return;
    const el = document.createElement('div');
    el.className = `end ${end}${effect ? ` ${effect}` : ''}`;
    el.innerHTML = '<span></span>';
    ends[end] = new maplibregl.Marker({ element: el, opacityWhenCovered: '0' }).setLngLat(lngLat).addTo(map);
  }

  const api = {
    // Set by the caller: whether the globe may spin now (nothing selected, no steps open).
    canSpin: () => true,

    // Zoom at which the whole globe fits the free part of the screen.
    fitZoom(padding) {
      const el = map.getContainer();
      const w = el.clientWidth - padding.left - padding.right;
      const h = el.clientHeight - padding.top - padding.bottom;
      const radius = 0.42 * Math.max(160, Math.min(w, h));
      return Math.log2((radius * 2 * Math.PI) / 512);
    },

    enter(padding) {
      saved = {};
      for (const l of layers()) {
        saved[l.id] = map.getLayoutProperty(l.id, 'visibility') ?? 'visible';
        show(l.id, GHURBA_IDS.has(l.id) || SHARED_IDS.has(l.id));
      }
      api.focus(false);
      saved.paint = {
        'gov-fill': ['fill-color', 'fill-opacity'].map((p) => [p, map.getPaintProperty('gov-fill', p)]),
        'gov-line': ['line-color', 'line-width'].map((p) => [p, map.getPaintProperty('gov-line', p)]),
      };
      map.setPaintProperty('gov-fill', 'fill-opacity', 1);
      map.setPaintProperty('gov-line', 'line-color', color.yemenLine);
      map.setPaintProperty('gov-line', 'line-width', 0.6);
      api.highlightGovs(null);
      map.setMaxBounds(null);
      map.setProjection({ type: 'globe' });
      map.setSky({ 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] });
      map.getContainer().classList.add('globe');
      api.overview(padding, 1600);
    },

    leave() {
      api.stopSpin();
      api.clearJourney();
      api.markFrom(null);
      api.markTo(null);
      api.showPicker(null);
      // The globe's camera padding would otherwise add to the Yemen view's own fitBounds padding.
      map.stop();
      map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
      for (const [id, vis] of Object.entries(saved ?? {})) if (id !== 'paint' && map.getLayer(id)) show(id, vis !== 'none');
      for (const [id, props] of Object.entries(saved?.paint ?? {})) for (const [p, v] of props) map.setPaintProperty(id, p, v);
      saved = null;
      map.getContainer().classList.remove('globe');
      map.setProjection({ type: 'mercator' });
      map.setMaxBounds(maxBounds);
    },

    setLand(data) {
      map.getSource('g-land').setData(data);
    },

    setLines(features) {
      map.getSource('g-lines').setData({ type: 'FeatureCollection', features });
    },

    // Only the lines of one governorate or one city; null shows all.
    filterLines(filter) {
      const f = filter?.gov ? ['==', ['get', 'g'], filter.gov] : filter?.city ? ['==', ['get', 'c'], filter.city] : null;
      map.setFilter('g-lines', f);
      map.setFilter('g-glow', f);
    },

    // Everyone's lines fade back while the visitor's own journey is on show.
    focus(on) {
      if (!saved) return;
      map.setPaintProperty('g-lines', 'line-opacity', on ? 0.25 : 0.85);
      show('g-glow', !on && !lite);
    },

    setCities(features, lang) {
      map.getSource('g-cities').setData({ type: 'FeatureCollection', features });
      api.setLang(lang);
    },

    setLang(lang) {
      for (const id of LABEL_IDS) map.setLayoutProperty(id, 'text-field', ['get', lang]);
    },

    // Governorates the current lines start from are lit; the others are dimmed. null lights all.
    highlightGovs(ids) {
      const hover = ['boolean', ['feature-state', 'hover'], false];
      map.setPaintProperty(
        'gov-fill',
        'fill-color',
        ids
          ? ['case', hover, color.yemenHover, ['in', ['get', 'id'], ['literal', ids]], color.yemen, color.yemenDim]
          : ['case', hover, color.yemenHover, color.yemen],
      );
    },

    // Picking where you are from: the governorates named, the chosen one's districts drawn and
    // named, the chosen district lit. pick is { gov, district }, or null to hide it all.
    showPicker(pick) {
      const gov = pick?.gov ?? '';
      for (const id of ['g-districts', 'g-district-lines', 'g-district-labels']) map.setFilter(id, ['==', ['get', 'gov'], gov]);
      map.setFilter('g-gov-labels', pick ? ['!=', ['get', 'id'], gov] : noLabels);
      if (picked) map.setFeatureState({ source: 'districts', id: picked }, { picked: false });
      picked = pick?.district ?? null;
      if (picked) map.setFeatureState({ source: 'districts', id: picked }, { picked: true });
    },

    // A dot where the visitor is from (pulsing while they pick), and a pin where they live now
    // (dropping into place when just chosen); null removes one.
    markFrom: (lngLat, pulse = false) => mark('from', lngLat, pulse && 'pulse'),
    markTo: (lngLat, drop = false) => mark('to', lngLat, drop && 'drop'),

    // The visitor's journey (see journey.js), each leg in its own style. With animate a vehicle
    // travels the way while the line is drawn behind it, turning into a ship where a sea leg
    // starts, with the sea's name for two seconds. onArrive runs once it is there (at once without
    // animation, as on weak devices and with reduced motion).
    drawJourney(j, { animate = true, lang = 'ar', onArrive } = {}) {
      stopTrip();
      const source = map.getSource('g-mine');
      const full = j.legs.map((l) => legFeature(l.kind, l.coords));
      const set = (features) => source.setData({ type: 'FeatureCollection', features });
      if (!animate || lite) {
        set(full);
        onArrive?.();
        return;
      }

      // The way as one list of points, and where each leg starts in it.
      const way = j.legs.flatMap((l, k) => (k ? l.coords.slice(1) : l.coords));
      const starts = [];
      let at = 0;
      for (const l of j.legs) {
        starts.push(at);
        at += l.coords.length - 1;
      }
      const end = way.length - 1;
      const ms = tripSeconds(j) * 1000;
      const ease = j.mode === 'direct' ? easeOut : easeInOut;
      let kind = null;
      if (j.mode !== 'direct') {
        vehicle = new maplibregl.Marker({ element: vehicleElement(), opacityWhenCovered: '0' }).setLngLat(way[0]).addTo(map);
      }

      // The vehicle takes the look of the leg it is on and faces the way it is going on screen:
      // the plane turns, the car and the ship look left or right.
      const drive = (here, ahead, leg) => {
        const el = vehicle.getElement();
        vehicle.setLngLat(here);
        if (leg.kind !== kind) {
          if (kind) replay(el, 'swap');
          kind = leg.kind;
          el.dataset.kind = kind;
          el.style.setProperty('--kind', COLORS[kind]);
          if (kind === 'sea' && leg.sea) {
            const name = el.querySelector('.sea-name');
            name.textContent = leg.sea[lang];
            replay(name, 'show');
          }
        }
        const p = map.project(here);
        const q = map.project(ahead);
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        if (Math.hypot(dx, dy) < 0.5) return;
        el.querySelector(`.icon[data-kind="${kind}"]`).style.transform =
          kind === 'air' ? `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI + 90}deg)` : dx < 0 ? 'scaleX(-1)' : '';
      };

      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / ms);
        const x = ease(t) * end;
        const i = Math.min(end - 1, Math.floor(x));
        const here = geoInterpolate(way[i], way[i + 1])(x - i);
        let k = 0;
        while (k + 1 < starts.length && starts[k + 1] <= x) k++;
        set([...full.slice(0, k), legFeature(j.legs[k].kind, [...way.slice(starts[k], i + 1), here])]);
        if (vehicle) drive(here, way[Math.min(end, i + 2)], j.legs[k]);
        if (t < 1) {
          trip = requestAnimationFrame(step);
          return;
        }
        // Arrived: the vehicle fades, the city pulses, then onArrive.
        set(full);
        if (vehicle) vehicle.getElement().classList.add('gone');
        const pin = ends.to?.getElement();
        if (pin) replay(pin, 'arrived');
        arrival = setTimeout(() => {
          vehicle?.remove();
          vehicle = null;
          onArrive?.();
        }, 700);
      };
      trip = requestAnimationFrame(step);
    },

    // Removes the visitor's journey and its vehicle (not the end markers).
    clearJourney() {
      stopTrip();
      map.getSource('g-mine').setData(empty);
    },

    // Camera on the line from a to b: centered on its middle, zoomed so it fits.
    frameLine(a, b, padding) {
      api.stopSpin();
      const mid = geoInterpolate(a, b)(0.5);
      const chord = 2 * Math.sin(geoDistance(a, b) / 2) || 0.01;
      const el = map.getContainer();
      const free = Math.min(el.clientWidth - padding.left - padding.right, el.clientHeight - padding.top - padding.bottom);
      const radius = (0.75 * Math.max(160, free)) / chord;
      const zoom = Math.min(5, Math.max(api.fitZoom(padding), Math.log2((radius * 2 * Math.PI) / 512)));
      map.flyTo({ center: mid, zoom, padding, duration: 1800, essential: true });
    },

    // Camera on part of Yemen: the whole country, a governorate or a district. The globe's camera
    // already keeps clear of the panel, so only a small margin is added.
    fitArea(bbox, maxZoom) {
      api.stopSpin();
      map.fitBounds(bbox, { padding: 24, maxZoom, duration: 1400, essential: true });
    },

    // Camera close on a point, such as a city just chosen.
    flyTo(center, padding, zoom = 4.5) {
      api.stopSpin();
      map.flyTo({ center, zoom, padding, duration: 1400, essential: true });
    },

    // Moves the globe clear of the panel after it changed sides or size.
    setPadding(padding) {
      const wasSpinning = spinning;
      api.stopSpin();
      map.easeTo({ padding, duration: 500 });
      if (wasSpinning) map.once('moveend', () => api.startSpin());
    },

    // The whole globe, centered near Yemen; it starts spinning once there.
    overview(padding, duration = 1200) {
      map.flyTo({ center: [45, 18], zoom: api.fitZoom(padding), padding, duration, essential: true });
      map.once('moveend', () => api.startSpin());
    },

    startSpin() {
      if (lite || spinning || !saved || !api.canSpin()) return;
      spinning = true;
      last = 0;
      frame = requestAnimationFrame(tick);
    },

    stopSpin() {
      spinning = false;
      cancelAnimationFrame(frame);
    },

    // Stops on any touch of the map and picks up again after 30 s untouched.
    pauseForUser() {
      api.stopSpin();
      clearTimeout(idle);
      idle = setTimeout(() => api.startSpin(), 30000);
    },
  };
  return api;
}
