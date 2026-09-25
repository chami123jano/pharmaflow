/**
 * Dev launcher: repairs the electron install, builds main + preload, waits for
 * Vite, then starts Electron.
 */
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const VITE_URL = process.env.VITE_DEV_URL || 'http://localhost:5173';

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

console.log('[dev] Checking electron install...');
try {
  run('node scripts/doctor.mjs --fix');
} catch {
  console.error('[dev] doctor failed');
  process.exit(1);
}

console.log('[dev] Building main + preload...');
try {
  run('node scripts/build-main.mjs');
  run('npx tsc -p tsconfig.preload.json');
} catch (e) {
  console.error('[dev] Build failed:', e.message);
  process.exit(1);
}

async function waitForVite(url, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await fetch(url);
      console.log('[dev] Vite ready at', url);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.warn('[dev] Vite not ready after', retries, 's - launching anyway');
  return false;
}

await waitForVite(VITE_URL);

// Resolve the real executable rather than node_modules/.bin/electron.cmd —
// Node 22 rejects spawning .cmd files without a shell (EINVAL). The electron
// package's main export is the absolute path to the binary.
const require = createRequire(import.meta.url);
const electronBin = require('electron');

if (typeof electronBin !== 'string' || !existsSync(electronBin)) {
  console.error('[dev] could not resolve electron binary; got:', electronBin);
  console.error('[dev] try: npm run doctor');
  process.exit(1);
}

// ELECTRON_RUN_AS_NODE makes electron.exe behave as plain Node, so
// require('electron') yields a path string and the app dies on ipcMain.
// VS Code's integrated terminal exports it, so strip it from the child env.
const env = { ...process.env, NODE_ENV: 'development', VITE_DEV_URL: VITE_URL };
delete env.ELECTRON_RUN_AS_NODE;

console.log('[dev] Launching Electron...');
const proc = spawn(electronBin, ['.'], { cwd: root, stdio: 'inherit', env });

proc.on('close', (code) => {
  console.log('[dev] Electron exited with code', code);
  process.exit(code ?? 0);
});
