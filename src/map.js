import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// The package's exports map hides the prebuilt UMD file, so reference it by path.
import rtlPluginUrl from '../node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url';

// Arabic labels need the RTL plugin for shaping and right-to-left order.
maplibregl.setRTLTextPlugin(rtlPluginUrl, false);

const PMTILES_URL = import.meta.env.VITE_PMTILES_URL;
const ASSETS = 'https://protomaps.github.io/basemaps-assets';

export const YEMEN_BOUNDS = [41.8, 12.0, 54.6, 19.1];

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
  if (!PMTILES_URL) return { sources: {}, layers: [] };
  const [{ Protocol }, { layers, namedFlavor }] = await Promise.all([
    import('pmtiles'),
    import('@protomaps/basemaps'),
  ]);
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  return {
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${PMTILES_URL}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
      },
    },
    layers: layers('protomaps', namedFlavor('light'), { lang }),
    relabel: (l) => layers('protomaps', namedFlavor('light'), { lang: l, labelsOnly: true }),
  };
}

export async function createMap(container, lang, padding) {
  const base = await basemap(lang);
  const hasBase = base.layers.length > 0;
  const src = (file) => `${import.meta.env.BASE_URL}data/${file}`;

  const map = new maplibregl.Map({
    container,
    bounds: YEMEN_BOUNDS,
    fitBoundsOptions: { padding },
    maxBounds: [
      [34, 7],
      [62, 24],
    ],
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
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': color.bg } },
        ...base.layers.filter((l) => l.type !== 'symbol'),
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

  const api = {
    map,

    // Hit test under a point: the visible district first, then the governorate.
    pick(point) {
      const [d] = map.queryRenderedFeatures(point, { layers: ['district-fill'] });
      if (d) return { type: 'district', id: d.properties.id };
      const [g] = map.queryRenderedFeatures(point, { layers: ['gov-fill'] });
      if (g) return { type: 'gov', id: g.properties.id };
      return null;
    },

    hover(hit) {
      setHover(hit && { source: hit.type === 'district' ? 'districts' : 'govs', id: hit.id });
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
