// The share card: a square PNG drawn in the browser, with the visitor's journey on a small globe,
// the "you are one of N" sentence and the site's address. Nothing is sent to a server.
import { geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from 'd3-geo';
import { COLORS, ICONS, loadLand } from './journey.js';

const SIZE = 1080;
const FONT = "'Thmanyah Sans', system-ui, sans-serif";

// Each kind of leg as on the globe: the plain line glows amber, the road is solid, the air and
// the sea are dashed.
const LEG_STYLE = {
  direct: { color: '#ffc65c', glow: '#ff9a2e', width: 6 },
  air: { color: COLORS.air, glow: 'rgba(255, 255, 255, 0.6)', width: 5, dash: [16, 12] },
  land: { color: COLORS.land, glow: COLORS.land, width: 6 },
  sea: { color: COLORS.sea, glow: COLORS.sea, width: 5, dash: [16, 12] },
};

// The vehicle in a round badge at x, y, facing angle (radians, on the canvas).
function drawVehicle(ctx, x, y, kind, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(11, 26, 46, 0.92)';
  ctx.shadowColor = COLORS[kind];
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLORS[kind];
  ctx.stroke();
  ctx.shadowBlur = 0;
  // The plane turns with the way; the car and the ship look left or right.
  if (kind === 'air') ctx.rotate(angle + Math.PI / 2);
  else if (Math.cos(angle) < 0) ctx.scale(-1, 1);
  ctx.scale(44 / 24, 44 / 24);
  ctx.translate(-12, -12);
  ctx.fillStyle = COLORS[kind];
  ctx.fill(new Path2D(ICONS[kind]), 'evenodd');
  ctx.restore();
}

// Splits text into lines that fit maxWidth at the current font.
function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return [...lines, line];
}

// journey: see journey.js. Resolves to a PNG Blob.
export async function renderCard({ journey, sentence, brand, call, lang }) {
  const from = journey.legs[0].coords[0];
  const to = journey.legs.at(-1).coords.at(-1);
  const [world] = await Promise.all([
    loadLand(),
    document.fonts.load(`700 60px ${FONT}`, sentence),
    document.fonts.load(`400 32px ${FONT}`, brand + call),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createRadialGradient(SIZE / 2, SIZE * 0.66, 40, SIZE / 2, SIZE * 0.66, SIZE * 0.85);
  sky.addColorStop(0, '#14294a');
  sky.addColorStop(1, '#040912');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Text first, so the globe can sit under however many lines the sentence takes.
  ctx.direction = lang === 'ar' ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(244, 232, 207, 0.75)';
  ctx.font = `400 34px ${FONT}`;
  ctx.fillText(brand, SIZE / 2, 96);

  let size = 62;
  ctx.font = `700 ${size}px ${FONT}`;
  let lines = wrap(ctx, sentence, SIZE - 160);
  if (lines.length > 2) {
    size = 52;
    ctx.font = `700 ${size}px ${FONT}`;
    lines = wrap(ctx, sentence, SIZE - 140);
  }
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => ctx.fillText(l, SIZE / 2, 190 + i * size * 1.3));
  const textBottom = 190 + (lines.length - 1) * size * 1.3;

  ctx.fillStyle = '#ffc65c';
  ctx.font = `400 32px ${FONT}`;
  ctx.fillText(call, SIZE / 2, SIZE - 48);

  // Globe centered a little south of the line's middle: both ends face the viewer, and the line
  // bows like an arc instead of crossing the center straight.
  const r = Math.min(290, (SIZE - 120 - textBottom - 70) / 2);
  const cx = SIZE / 2;
  const cy = textBottom + 60 + r;
  const mid = geoInterpolate(from, to)(0.5);
  const view = [mid[0], Math.max(-60, mid[1] - Math.min(25, 80 - (geoDistance(from, to) * 90) / Math.PI))];
  const projection = geoOrthographic().rotate([-view[0], -view[1]]).translate([cx, cy]).scale(r).clipAngle(90);
  const path = geoPath(projection, ctx);

  const halo = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.22);
  halo.addColorStop(0, 'rgba(120, 170, 255, 0.32)');
  halo.addColorStop(1, 'rgba(120, 170, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.22, 0, 2 * Math.PI);
  ctx.fill();

  ctx.beginPath();
  path({ type: 'Sphere' });
  ctx.fillStyle = '#0b1a2e';
  ctx.fill();
  ctx.beginPath();
  path(geoGraticule10());
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  path(world);
  ctx.fillStyle = '#20385a';
  ctx.fill();

  // d3 draws a LineString on the sphere as great-circle arcs.
  for (const leg of journey.legs) {
    const style = LEG_STYLE[leg.kind];
    ctx.save();
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = style.dash ? 'butt' : 'round';
    ctx.setLineDash(style.dash ?? []);
    ctx.beginPath();
    path({ type: 'LineString', coordinates: leg.coords });
    ctx.stroke();
    ctx.restore();
  }

  for (const [point, radius, fill] of [
    [from, 8, '#d9a441'],
    [to, 12, '#ffffff'],
  ]) {
    if (geoDistance(point, view) > Math.PI / 2) continue;
    const [x, y] = projection(point);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // The vehicle halfway along the way, on the leg it would be on there.
  if (journey.mode !== 'direct') {
    let k = 0;
    let left = journey.km / 2;
    while (k < journey.legs.length - 1 && left > journey.legs[k].km) left -= journey.legs[k++].km;
    const leg = journey.legs[k];
    const i = Math.min(leg.coords.length - 2, Math.floor((left / leg.km) * (leg.coords.length - 1)));
    const [here, ahead] = [leg.coords[i], leg.coords[i + 1]];
    if (geoDistance(here, view) < Math.PI / 2) {
      const [x, y] = projection(here);
      const [x2, y2] = projection(ahead);
      drawVehicle(ctx, x, y, leg.kind, Math.atan2(y2 - y, x2 - x));
    }
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the card'))), 'image/png'),
  );
}
