/**
 * Stamps the icon and version details onto the packaged .exe.
 *
 * electron-builder normally does this itself, using a tool it unpacks from its
 * signing-tools bundle. On a Windows machine without Developer Mode that
 * unpacking fails — it tries to create symbolic links for the macOS half of
 * the bundle, which needs a privilege a normal account does not have. The
 * build carries on and reports success, but the icon step is silently skipped
 * and the program keeps Electron's default atom in the taskbar.
 *
 * So it is done here instead, with rcedit called directly. Run after
 * packaging; `npm run package` does it automatically.
 */
import { createRequire } from 'module';

// rcedit ships CommonJS and exports a named function, not a default, so it is
// required rather than imported.
const { rcedit } = createRequire(import.meta.url)('rcedit');
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist-build/win-unpacked');
const icon = resolve(root, 'build/icon.ico');

if (!existsSync(outDir)) {
  console.error('[brand] nothing packaged yet — run the build first');
  process.exit(1);
}
if (!existsSync(icon)) {
  console.error('[brand] build/icon.ico is missing — run scripts/make-icon.mjs');
  process.exit(1);
}

const exe = readdirSync(outDir).find((f) => f.endsWith('.exe') && !/unins/i.test(f));
if (!exe) {
  console.error('[brand] no .exe found in', outDir);
  process.exit(1);
}

const target = join(outDir, exe);
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const productName = (process.env.SHOP_NAME || 'PharmaFlow').trim();

await rcedit(target, {
  icon,
  'version-string': {
    ProductName: productName,
    FileDescription: productName,
    CompanyName: productName,
    LegalCopyright: `© ${new Date().getFullYear()} ${productName}`,
    OriginalFilename: exe,
  },
  'file-version': pkg.version,
  'product-version': pkg.version,
});

/**
 * rcedit reports success even when it changed nothing, so check the bytes.
 *
 * Windows stores each size as its own resource, so the .ico's directory header
 * is not copied in — only the image bodies. Looking for the file verbatim
 * finds nothing even on a perfectly branded .exe, which is a false alarm worth
 * avoiding.
 */
const stamped = readFileSync(target);
const ico = readFileSync(icon);
const count = ico.readUInt16LE(4);
let embedded = 0;
for (let i = 0; i < count; i++) {
  const entry = 6 + i * 16;
  const offset = ico.readUInt32LE(entry + 12);
  const length = ico.readUInt32LE(entry + 8);
  if (stamped.includes(ico.subarray(offset, offset + Math.min(length, 256)))) embedded++;
}
if (embedded < count) {
  console.error(`[brand] rcedit ran but only ${embedded}/${count} icon sizes reached the .exe`);
  process.exit(1);
}

console.log(`[brand] ${exe}  ${embedded}/${count} icon sizes applied, ${(statSync(target).size / 1024 / 1024).toFixed(0)} MB, "${productName}"`);
