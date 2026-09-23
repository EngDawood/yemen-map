// Ghurba mode on the map: a globe with a great-circle line from each district to each city.
// The layers live in the map style from the start (hidden), so switching modes only toggles
// visibility, projection and bounds.
import { geoDistance, geoInterpolate } from 'd3-geo';

const color = {
  ocean: '#0b1a2e',
  land: '#1c2e46',
  yemen: '#d9a441',
  yemenHover: '#f0c46a',
  yemenDim: '#6b5634',
  yemenLine: '#0b1a2e',
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
  {
    id: 'g-mine-glow',
    type: 'line',
    source: 'g-mine',
    layout: { ...hidden, 'line-cap': 'round' },
    paint: { 'line-color': color.mine, 'line-opacity': 0.35, 'line-blur': 4, 'line-width': 9 },
  },
  {
    id: 'g-mine',
    type: 'line',
    source: 'g-mine',
    layout: { ...hidden, 'line-cap': 'round' },
    paint: { 'line-color': color.mine, 'line-width': 2.5 },
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
];

const GHURBA_IDS = new Set([...ghurbaBottomLayers, ...ghurbaTopLayers].map((l) => l.id));
// Yemen's governorates stay on the globe as the place every line starts from.
const SHARED_IDS = new Set(['gov-fill', 'gov-line']);

// Great-circle points from a to b ([lon, lat]), split where they cross the antimeridian so the
// map does not draw them the long way round.
export function greatCircle(a, b) {
  const steps = Math.max(8, Math.ceil((geoDistance(a, b) * 180) / Math.PI / 1.5));
  const at = geoInterpolate(a, b);
  const parts = [[a]];
  let prev = a;
  for (let i = 1; i <= steps; i++) {
    const p = at(i / steps);
    if (Math.abs(p[0] - prev[0]) > 180) {
      const side = prev[0] > 0 ? 180 : -180;
      const t = (side - prev[0]) / (p[0] + 2 * side - prev[0]);
      const lat = prev[1] + t * (p[1] - prev[1]);
      parts.at(-1).push([side, lat]);
      parts.push([[-side, lat]]);
    }
    parts.at(-1).push(p);
    prev = p;
  }
  return parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
}

export function createGlobe(map, { maxBounds, lite }) {
  let saved = null; // Yemen-mode visibility and paint, restored on leave
  let spinning = false;
  let frame = 0;
  let last = 0;
  let idle = 0;
  let drawing = 0;

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

  const api = {
    // Set by the caller: whether the globe may spin now (nothing selected, no dialog open).
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
      if (lite) show('g-glow', false);
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
      cancelAnimationFrame(drawing);
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

    setLand(url) {
      map.getSource('g-land').setData(url);
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

    setCities(features, lang) {
      map.getSource('g-cities').setData({ type: 'FeatureCollection', features });
      api.setLang(lang);
    },

    setLang(lang) {
      map.setLayoutProperty('g-city-labels', 'text-field', ['get', lang]);
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

    // Draws the visitor's own line from a to b over about two seconds.
    drawMine(a, b, animate = true) {
      cancelAnimationFrame(drawing);
      const geom = greatCircle(a, b);
      const coords = geom.type === 'LineString' ? geom.coordinates : geom.coordinates.flat();
      const source = map.getSource('g-mine');
      const set = (n) => {
        // Rebuild the split so a partial line crossing the antimeridian stays correct.
        const part = n >= coords.length ? geom : greatCirclePrefix(coords.slice(0, Math.max(2, n)));
        source.setData({ type: 'Feature', properties: {}, geometry: part });
      };
      if (!animate) return set(Infinity);
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / 2000);
        set(Math.ceil(coords.length * (1 - (1 - t) ** 3)));
        if (t < 1) drawing = requestAnimationFrame(step);
      };
      drawing = requestAnimationFrame(step);
    },

    clearMine() {
      cancelAnimationFrame(drawing);
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

// A LineString, or a MultiLineString when the points jump across the antimeridian.
function greatCirclePrefix(points) {
  const parts = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i][0] - points[i - 1][0]) > 180) parts.push([]);
    parts.at(-1).push(points[i]);
  }
  return parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
}
