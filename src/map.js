import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// The package's exports map hides the prebuilt UMD file, so reference it by path.
import rtlPluginUrl from '../node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url';
import { createGlobe, ghurbaBottomLayers, ghurbaSources, ghurbaTopLayers } from './globe.js';

// Arabic labels need the RTL plugin for shaping and right-to-left order.
// Deferred: it downloads only once Arabic text is on the map.
maplibregl.setRTLTextPlugin(rtlPluginUrl, true);

// Folder holding region.pmtiles and yemen.pmtiles (see .github/workflows/basemap.yml).
const BASEMAP_URL = import.meta.env.VITE_BASEMAP_URL;
const ASSETS = 'https://protomaps.github.io/basemaps-assets';

// region.pmtiles is wide but stops at this zoom; yemen.pmtiles has the detail from here on.
const DETAIL_ZOOM = 6;

export const YEMEN_BOUNDS = [41.8, 12.0, 54.6, 19.1];
// Same area as region.pmtiles, so panning never runs off the base map. Lifted in Ghurba mode.
export const MAX_BOUNDS = [
  [20, -12],
  [78, 38],
];

const color = {
  bg: '#dce4e6',
  land: '#efe6d4',
  landHover: '#e2d2b0',
  landDim: '#e6e1d8',
  line: '#ffffff',
  accent: '#b3261e',
  district: '#f7f1e6',
  districtHover: '#ecd9b6',
  districtSelected: '#f2c9a8',
  text: '#3b3226',
  halo: 'rgba(255,255,255,0.9)',
};

async function basemap(lang) {
  const none = { sources: {}, layers: [] };
  if (!BASEMAP_URL) return none;
  const [{ PMTiles, Protocol }, { layers, namedFlavor }] = await Promise.all([
    import('pmtiles'),
    import('@protomaps/basemaps'),
  ]);
  const archives = ['region', 'yemen'].map((name) => [name, new PMTiles(`${BASEMAP_URL}/${name}.pmtiles`)]);
  try {
    await Promise.all(archives.map(([, archive]) => archive.getHeader()));
  } catch (err) {
    // The map still works on its own, e.g. before the tiles are first published.
    console.warn('Base map unavailable, continuing without it.', err);
    return none;
  }

  const protocol = new Protocol();
  const sources = {};
  for (const [name, archive] of archives) {
    protocol.add(archive);
    sources[name] = {
      type: 'vector',
      url: `pmtiles://${archive.source.getKey()}`,
      attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
    };
  }
  maplibregl.addProtocol('pmtiles', protocol.tile);

  // The region style draws everywhere (overzoomed past DETAIL_ZOOM) with its labels up to
  // DETAIL_ZOOM; the Yemen style draws on top of it from DETAIL_ZOOM.
  const flavor = namedFlavor('light');
  const style = (l, labelsOnly = false) => [
    ...layers('region', flavor, { lang: l, labelsOnly }).map((layer) => ({
      ...layer,
      id: `region-${layer.id}`,
      ...(layer.type === 'symbol' && { maxzoom: Math.min(layer.maxzoom ?? 24, DETAIL_ZOOM) }),
    })),
    ...layers('yemen', flavor, { lang: l, labelsOnly })
      .filter((layer) => layer.type !== 'background')
      .map((layer) => ({ ...layer, minzoom: Math.max(layer.minzoom ?? 0, DETAIL_ZOOM) })),
  ];

  return { sources, layers: style(lang), relabel: (l) => style(l, true) };
}

// lite: skip the costly effects (spinning, glow) on weak devices.
export async function createMap(container, lang, padding, { lite = false } = {}) {
  const base = await basemap(lang);
  const hasBase = base.layers.length > 0;
  const src = (file) => `${import.meta.env.BASE_URL}data/${file}`;

  const map = new maplibregl.Map({
    container,
    bounds: YEMEN_BOUNDS,
    fitBoundsOptions: { padding },
    maxBounds: MAX_BOUNDS,
    attributionControl: false,
    style: {
      version: 8,
      glyphs: `${ASSETS}/fonts/{fontstack}/{range}.pbf`,
      ...(hasBase && { sprite: `${ASSETS}/sprites/v4/light` }),
      sources: {
        ...base.sources,
        govs: {
          type: 'geojson',
          data: src('governorates.geojson'),
          promoteId: 'id',
          attribution: 'OCHA COD-AB · HDX',
        },
        districts: { type: 'geojson', data: src('districts.geojson'), promoteId: 'id' },
        'gov-labels': { type: 'geojson', data: src('governorate-labels.geojson') },
        'district-labels': { type: 'geojson', data: src('district-labels.geojson') },
        ...ghurbaSources,
      },
      layers: [
        ...ghurbaBottomLayers,
        ...(hasBase
          ? base.layers.filter((l) => l.type !== 'symbol')
          : [{ id: 'background', type: 'background', paint: { 'background-color': color.bg } }]),
        {
          id: 'gov-fill',
          type: 'fill',
          source: 'govs',
          paint: {
            'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], color.landHover, color.land],
            'fill-opacity': hasBase ? 0.45 : 1,
          },
        },
        {
          id: 'district-fill',
          type: 'fill',
          source: 'districts',
          filter: ['==', ['get', 'gov'], ''],
          paint: {
            'fill-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              color.districtSelected,
              ['boolean', ['feature-state', 'hover'], false],
              color.districtHover,
              color.district,
            ],
            'fill-opacity': hasBase ? 0.6 : 1,
          },
        },
        {
          id: 'district-line',
          type: 'line',
          source: 'districts',
          filter: ['==', ['get', 'gov'], ''],
          paint: { 'line-color': '#c9b48e', 'line-width': 0.8 },
        },
        {
          id: 'gov-line',
          type: 'line',
          source: 'govs',
          paint: { 'line-color': color.line, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 9, 2.5] },
        },
        {
          id: 'gov-selected',
          type: 'line',
          source: 'govs',
          filter: ['==', ['get', 'id'], ''],
          paint: { 'line-color': color.accent, 'line-width': 2.5 },
        },
        {
          id: 'district-selected',
          type: 'line',
          source: 'districts',
          filter: ['==', ['get', 'id'], ''],
          paint: { 'line-color': color.accent, 'line-width': 2 },
        },
        ...base.layers.filter((l) => l.type === 'symbol'),
        {
          id: 'district-label',
          type: 'symbol',
          source: 'district-labels',
          filter: ['==', ['get', 'gov'], ''],
          layout: {
            'text-field': ['get', lang],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-max-width': 7,
          },
          paint: { 'text-color': color.text, 'text-halo-color': color.halo, 'text-halo-width': 1.4 },
        },
        {
          id: 'gov-label',
          type: 'symbol',
          source: 'gov-labels',
          layout: {
            'text-field': ['get', lang],
            'text-font': ['Noto Sans Medium'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 5, 12, 8, 16],
            'text-max-width': 8,
          },
          paint: { 'text-color': color.text, 'text-halo-color': color.halo, 'text-halo-width': 1.6 },
        },
        ...ghurbaTopLayers,
      ],
    },
  });

  let hovered = null; // { source, id }
  const setHover = (next) => {
    if (hovered?.id === next?.id) return;
    if (hovered) map.setFeatureState(hovered, { hover: false });
    hovered = next;
    if (hovered) map.setFeatureState(hovered, { hover: true });
    map.getCanvas().style.cursor = hovered ? 'pointer' : '';
  };

  let selectedDistrict = null;
  const controls = [
    new maplibregl.NavigationControl({ visualizePitch: false }),
    new maplibregl.AttributionControl({ compact: true }),
  ];

  const sources = { district: 'districts', gov: 'govs', city: 'g-cities' };

  const api = {
    map,
    globe: createGlobe(map, { maxBounds: MAX_BOUNDS, lite }),

    // Hit test under a point: a Ghurba city, then the visible district, then the governorate.
    // Hidden layers never match, so this works in both modes.
    pick(point) {
      const [c] = map.queryRenderedFeatures(point, { layers: ['g-cities'] });
      if (c) return { type: 'city', id: c.properties.id };
      const [d] = map.queryRenderedFeatures(point, { layers: ['district-fill', 'g-districts'] });
      if (d) return { type: 'district', id: d.properties.id };
      const [g] = map.queryRenderedFeatures(point, { layers: ['gov-fill'] });
      if (g) return { type: 'gov', id: g.properties.id };
      return null;
    },

    hover(hit) {
      setHover(hit && { source: sources[hit.type], id: hit.id });
    },

    // govId and districtId may be null to go back up a level.
    select(govId, districtId) {
      const g = govId ?? '';
      const others = ['!=', ['get', 'id'], g];
      map.setFilter('district-fill', ['==', ['get', 'gov'], g]);
      map.setFilter('district-line', ['==', ['get', 'gov'], g]);
      map.setFilter('district-label', ['==', ['get', 'gov'], g]);
      map.setFilter('gov-selected', ['==', ['get', 'id'], g]);
      map.setFilter('gov-label', govId ? others : null);
      map.setPaintProperty('gov-fill', 'fill-color', [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        color.landHover,
        govId ? color.landDim : color.land,
      ]);

      if (selectedDistrict) map.setFeatureState({ source: 'districts', id: selectedDistrict }, { selected: false });
      selectedDistrict = districtId;
      if (districtId) map.setFeatureState({ source: 'districts', id: districtId }, { selected: true });
      map.setFilter('district-selected', ['==', ['get', 'id'], districtId ?? '']);
    },

    fit(bbox, padding) {
      map.fitBounds(bbox, { padding, maxZoom: 10, duration: 900 });
    },

    // Controls sit on the side away from the panel, which follows text direction.
    placeControls(l) {
      const pos = l === 'ar' ? 'bottom-left' : 'bottom-right';
      for (const c of controls) if (map.hasControl(c)) map.removeControl(c);
      for (const c of controls) map.addControl(c, pos);
    },

    setLang(l) {
      api.placeControls(l);
      map.setLayoutProperty('gov-label', 'text-field', ['get', l]);
      map.setLayoutProperty('district-label', 'text-field', ['get', l]);
      api.globe.setLang(l);
      for (const layer of base.relabel?.(l) ?? []) {
        if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'text-field', layer.layout['text-field']);
      }
    },
  };

  map.on('mousemove', (e) => api.hover(api.pick(e.point)));
  map.on('mouseout', () => setHover(null));

  api.placeControls(lang);
  // Layers exist once the style loads; no need to wait for tiles or glyphs.
  if (!map.isStyleLoaded()) await new Promise((resolve) => map.once('style.load', resolve));
  return api;
}
