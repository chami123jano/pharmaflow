/**
 * Draws the app icons from the shop's name.
 *
 * The icon has to be a real PNG — a phone home screen will not take an SVG —
 * so it cannot simply be a string in the page like the header badge is. It is
 * rendered here instead of committed, because a fixed file would show the
 * wrong shop the moment someone else built this repo.
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

/** Kept in step with src/lib/initials.ts — same rule, same result. */
function initials(name) {
  const cleaned = (name || '').trim();
  if (!cleaned) return '??';
  const words = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s\-_.]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
}

// Named explicitly rather than left to "sans-serif": a build server picks a
// different default from a laptop, and the icon would quietly change shape.
const FONTS = 'Segoe UI, DejaVu Sans, Liberation Sans, Noto Sans, Arial, Helvetica, sans-serif';

const svg = (text, size, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rounded ? Math.round(size * 0.22) : 0}" fill="#2563eb"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="${FONTS}" font-size="${Math.round(size * (text.length > 2 ? 0.34 : 0.42))}"
        font-weight="700" letter-spacing="${Math.round(size * -0.008)}" fill="#ffffff">${text}</text>
</svg>`;

function render(text, size, rounded) {
  const png = new Resvg(svg(text, size, rounded), {
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
    fitTo: { mode: 'width', value: size },
  }).render();
  return { png: png.asPng(), pixels: png.pixels, width: png.width, height: png.height };
}

/**
 * Fail loudly if the letters did not draw.
 *
 * Without a usable font resvg renders the background and silently drops the
 * text, and the result is a blank blue square that looks deliberate. Comparing
 * the middle of the icon against its background catches that.
 */
function assertTextRendered(out, label) {
  const { pixels, width, height } = out;
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };
  let white = 0;
  for (let y = Math.floor(height * 0.35); y < height * 0.65; y++) {
    for (let x = Math.floor(width * 0.2); x < width * 0.8; x++) {
      const [r, g, b] = at(x, y);
      if (r > 200 && g > 200 && b > 200) white++;
    }
  }
  const area = (height * 0.3) * (width * 0.6);
  const ratio = white / area;
  if (ratio < 0.03) {
    throw new Error(
      `${label}: the letters did not render (only ${(ratio * 100).toFixed(1)}% of the centre is ink). ` +
      `No usable font was found on this machine.`
    );
  }
  return ratio;
}

const name = shopName();
const mark = initials(name);

for (const [size, file, rounded] of [
  [192, 'icon-192.png', true],
  [512, 'icon-512.png', true],
  [180, 'apple-touch-icon.png', false], // iOS rounds it itself
]) {
  const out = render(mark, size, rounded);
  const ink = assertTextRendered(out, file);
  writeFileSync(resolve(root, 'dist', file), out.png);
  console.log(`[icons] ${file.padEnd(22)} "${mark}"  ${(ink * 100).toFixed(0)}% ink`);
}

console.log(`[icons] drawn from "${name}"`);
