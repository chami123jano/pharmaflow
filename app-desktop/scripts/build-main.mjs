/**
 * Builds the Electron main process bundle.
 *
 * Output is CommonJS at dist/main/main.cjs to match package.json "main".
 * The .cjs extension matters: package.json sets "type": "module", so a plain
 * .js file here would be loaded as ESM and Electron's main process would fail.
 *
 * 'electron' and 'sql.js' stay external — Electron supplies the first at
 * runtime, and sql.js must load its .wasm from node_modules rather than being
 * inlined into the bundle.
 */
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function main() {
  // Preload must also be CJS with an explicit .cjs extension. package.json
  // declares "type": "module", so a .js preload is loaded as ESM, throws on
  // its first require(), and contextBridge never runs — leaving window.api
  // undefined and every action in the UI silently failing.
  await build({
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: false,
    external: ['electron'],
    entryPoints: [path.join(root, 'src/preload/index.ts')],
    outfile: path.join(root, 'dist/preload/index.cjs'),
  });
  console.log('[build] dist/preload/index.cjs built (cjs)');

  await build({
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: false,
    external: ['electron', 'sql.js', 'electron-log', 'electron-window-state'],
    entryPoints: [path.join(root, 'src/main/main.ts')],
    outfile: path.join(root, 'dist/main/main.cjs'),
    // src/main uses import.meta.url (fileURLToPath, createRequire), which does
    // not exist in CJS output. Map it onto a __filename-derived file:// URL so
    // those call sites keep working.
    define: { 'import.meta.url': '__importMetaUrl' },
    banner: {
      js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;',
    },
  });
  console.log('[build] dist/main/main.cjs built (cjs)');
}

main().catch((err) => {
  console.error('[build] failed:', err);
  process.exit(1);
});
