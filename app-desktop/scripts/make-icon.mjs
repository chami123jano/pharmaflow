/**
 * Builds build/icon.ico from the pharmacy mark.
 *
 * There was no icon file at all, so packaged builds wore Electron's default
 * and looked like somebody else's software in the taskbar.
 *
 * Windows wants a single .ico holding several sizes; it picks the nearest one
 * rather than scaling, which is why 16px is drawn separately instead of being
 * shrunk from 256. An .ico is a short header followed by whole PNG files, so
 * it is assembled here rather than pulling in an image library.
 *
 * The mark is the one in src/renderer/src/components/Logo.tsx. Keep them in
 * step. Run with:  node scripts/make-icon.mjs
 */
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NAVY = '#12385f';
const TEAL = '#0e9da0';
const LIME = '#8bc53f';

// Which mark to draw, matching the app's `pharmacy.logo` setting. Left unset
// it draws the neutral one, so a plain `node scripts/make-icon.mjs` produces
// the product's own icon rather than some particular shop's.
const MARK = (process.env.LOGO || '').trim() === 'capsule' ? 'capsule' : 'cross';

const CROSS = 'M25 7h14a3 3 0 0 1 3 3v12h12a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H42v12a3 3 0 0 1-3 3H25a3 3 0 0 1-3-3V42H10a3 3 0 0 1-3-3V25a3 3 0 0 1 3-3h12V10a3 3 0 0 1 3-3z';
const TRACE = 'M4 32h17l3-10 4 19 4-13 3 4h25';

/**
 * Below about 32px the fine detail turns to mush, so the small sizes are drawn
 * plainer. A taskbar icon has to read at a glance, not show off.
 */
const capsule = (size) => {
  const detailed = size >= 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="${size >= 32 ? 14 : 10}" fill="#ffffff"/>
  <g fill="none" stroke-width="${detailed ? 9.5 : 11}" stroke-linecap="round">
    <path d="M46 17.5A21 21 0 0 0 11 32" stroke="${NAVY}"/>
    <path d="M11 32A21 21 0 0 0 46 46.5" stroke="${TEAL}"/>
  </g>
  ${detailed ? `<path d="M6.6 32h8.8" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>` : ''}
  <path d="M23 32h5.5l2.5-7.5 3.5 15 2.5-7.5H43" fill="none" stroke="${LIME}"
        stroke-width="${detailed ? 4.2 : 5.5}" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
};

const cross = (size) => {
  const detailed = size >= 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <defs><clipPath id="x"><path d="${CROSS}"/></clipPath></defs>
  <rect width="64" height="64" rx="${size >= 32 ? 14 : 10}" fill="#ffffff"/>
  <g clip-path="url(#x)">
    <path d="${CROSS}" fill="${NAVY}"/>
    <path d="M64 6 64 64 6 64Z" fill="${TEAL}"/>
  </g>
  ${detailed ? `<g transform="rotate(-45 47 17)">
    <rect x="37" y="11" width="20" height="12" rx="6" fill="${LIME}"/>
    <path d="M47 11v12" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>
  </g>` : ''}
  <path d="${TRACE}" fill="none" stroke="#ffffff" stroke-width="${detailed ? 8.5 : 10}" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${TRACE}" fill="none" stroke="${LIME}" stroke-width="${detailed ? 4 : 5}" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
};

const svg = (size) => (MARK === 'capsule' ? capsule : cross)(size);

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const images = SIZES.map((size) => {
  const png = new Resvg(svg(size), { fitTo: { mode: 'width', value: size } }).render().asPng();
  return { size, png };
});

// ICONDIR, then one ICONDIRENTRY per image, then the PNGs themselves.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);              // reserved
header.writeUInt16LE(1, 2);              // 1 = icon
header.writeUInt16LE(images.length, 4);

const entries = Buffer.alloc(16 * images.length);
let offset = header.length + entries.length;

images.forEach((img, i) => {
  const at = i * 16;
  entries[at] = img.size >= 256 ? 0 : img.size;      // 0 means 256
  entries[at + 1] = img.size >= 256 ? 0 : img.size;
  entries[at + 2] = 0;                               // palette size
  entries[at + 3] = 0;                               // reserved
  entries.writeUInt16LE(1, at + 4);                  // colour planes
  entries.writeUInt16LE(32, at + 6);                 // bits per pixel
  entries.writeUInt32LE(img.png.length, at + 8);
  entries.writeUInt32LE(offset, at + 12);
  offset += img.png.length;
});

mkdirSync(resolve(root, 'build'), { recursive: true });
const ico = Buffer.concat([header, entries, ...images.map((i) => i.png)]);
writeFileSync(resolve(root, 'build/icon.ico'), ico);

console.log(`[icon] build/icon.ico  "${MARK}"  ${images.length} sizes (${SIZES.join(', ')})  ${(ico.length / 1024).toFixed(1)} KB`);
