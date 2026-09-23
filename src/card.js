// The share card: a square PNG drawn in the browser, with the visitor's line on a small globe,
// the "you are one of N" sentence and the site's address. Nothing is sent to a server.
import { geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from 'd3-geo';

const SIZE = 1080;
const FONT = "'Thmanyah Sans', system-ui, sans-serif";
let land = null;

function loadLand() {
  land ??= fetch(`${import.meta.env.BASE_URL}data/land.geojson`)
    .then((r) => r.json())
    .catch((err) => {
      land = null;
      throw err;
    });
  return land;
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

// from, to: [lon, lat]. Resolves to a PNG Blob.
export async function renderCard({ from, to, sentence, brand, call, lang }) {
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

  // d3 draws a LineString on the sphere as a great circle.
  ctx.save();
  ctx.shadowColor = '#ff9a2e';
  ctx.shadowBlur = 26;
  ctx.strokeStyle = '#ffc65c';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  path({ type: 'LineString', coordinates: [from, to] });
  ctx.stroke();
  ctx.restore();

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

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the card'))), 'image/png'),
  );
}
