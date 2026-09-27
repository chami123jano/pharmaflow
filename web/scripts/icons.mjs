/**
 * Draws the app icons.
 *
 * The icon has to be a real PNG — a phone home screen will not take an SVG —
 * so it cannot simply be a component like the header logo is. It is rendered
 * here rather than committed so the two can never drift apart.
 *
 * The mark is the one in src/components/Logo.tsx. Keep the two in step.
 *
 * Rasterised with resvg rather than a browser, so it works on a build server
 * with no display.
 */
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function shopName() {
  if (process.env.VITE_SHOP_NAME) return process.env.VITE_SHOP_NAME.trim();
  try {
    const env = readFileSync(resolve(root, '.env'), 'utf8');
    const m = env.match(/^VITE_SHOP_NAME=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return 'PharmaFlow';
}

const NAVY = '#1d3b6e';
const TEAL = '#17a3a3';
const LIME = '#7cc242';

const CROSS = 'M25 7h14a3 3 0 0 1 3 3v12h12a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H42v12a3 3 0 0 1-3 3H25a3 3 0 0 1-3-3V42H10a3 3 0 0 1-3-3V25a3 3 0 0 1 3-3h12V10a3 3 0 0 1 3-3z';
const TRACE = 'M4 32h17l3-10 4 19 4-13 3 4h25';

const svg = (size, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <defs><clipPath id="x"><path d="${CROSS}"/></clipPath></defs>
  <rect width="64" height="64" rx="${rounded ? 15 : 0}" fill="#ffffff"/>
  <g clip-path="url(#x)">
    <path d="${CROSS}" fill="${NAVY}"/>
    <path d="M64 6 64 64 6 64Z" fill="${TEAL}"/>
  </g>
  <g transform="rotate(-45 47 17)">
    <rect x="37" y="11" width="20" height="12" rx="6" fill="${LIME}"/>
    <path d="M47 11v12" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>
  </g>
  <path d="${TRACE}" fill="none" stroke="#ffffff" stroke-width="8.5" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${TRACE}" fill="none" stroke="${LIME}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;

function render(size, rounded) {
  const out = new Resvg(svg(size, rounded), { fitTo: { mode: 'width', value: size } }).render();
  return { png: out.asPng(), pixels: out.pixels, width: out.width, height: out.height };
}

/**
 * Fail loudly if the mark did not draw.
 *
 * A blank white square looks deliberate, so a silent failure here would ship.
 * The cross sits dead centre, so the middle must not be white.
 */
function assertMarkRendered(out, label) {
  const { pixels, width, height } = out;
  let coloured = 0, total = 0;
  for (let y = Math.floor(height * 0.4); y < height * 0.6; y++) {
    for (let x = Math.floor(width * 0.4); x < width * 0.6; x++) {
      const i = (y * width + x) * 4;
      total++;
      if (pixels[i] < 220 || pixels[i + 1] < 220 || pixels[i + 2] < 220) coloured++;
    }
  }
  const ratio = coloured / Math.max(total, 1);
  if (ratio < 0.5) {
    throw new Error(`${label}: the mark did not render — the centre is ${(100 - ratio * 100).toFixed(0)}% blank.`);
  }
  return ratio;
}

for (const [size, file, rounded] of [
  [192, 'icon-192.png', true],
  [512, 'icon-512.png', true],
  [180, 'apple-touch-icon.png', false], // iOS rounds it itself
  [64, 'favicon.png', true],
]) {
  const out = render(size, rounded);
  const ink = assertMarkRendered(out, file);
  writeFileSync(resolve(root, 'dist', file), out.png);
  console.log(`[icons] ${file.padEnd(22)} ${(ink * 100).toFixed(0)}% covered`);
}

// The SVG is what a browser tab prefers — sharp at any zoom, a fraction of the
// size, and no separate file to keep in step.
writeFileSync(resolve(root, 'dist', 'favicon.svg'), svg(64, 15));
console.log(`[icons] drawn for "${shopName()}"`);
