/**
 * Verifies the local Electron install is sane before launching.
 *
 * Three things have broken this app before and all three are silent — the app
 * either hangs with no window or exits with a confusing module error:
 *
 *   1. node_modules/electron/index.js replaced with a hand-written proxy that
 *      polls Module._cache forever and never boots.
 *   2. A stale app.asar left in node_modules/electron/dist/resources/, which
 *      Electron always prefers over the path given on the command line — so
 *      every launch silently runs a frozen old build instead of your source.
 *   3. ELECTRON_RUN_AS_NODE inherited from a parent process (VS Code's
 *      integrated terminal sets it), which makes electron.exe run as plain
 *      Node, so require('electron') returns a path string instead of the API.
 *
 * Run with --fix to repair 1 and 2. 3 is handled by the launcher.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const indexJs = path.join(electronDir, 'index.js');
const plantedAsar = path.join(electronDir, 'dist', 'resources', 'app.asar');
const quarantine = path.join(root, '.quarantine');

const STOCK_INDEX = `const fs = require('fs');
const path = require('path');

const pathFile = path.join(__dirname, 'path.txt');

function getElectronPath () {
  let executablePath;
  if (fs.existsSync(pathFile)) {
    executablePath = fs.readFileSync(pathFile, 'utf-8');
  }
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || 'electron');
  }
  if (executablePath) {
    return path.join(__dirname, 'dist', executablePath);
  } else {
    throw new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again');
  }
}

module.exports = getElectronPath();
`;

const fix = process.argv.includes('--fix');
const problems = [];

if (existsSync(electronDir)) {
  // 1. Tampered loader. The stock file is ~20 lines and never references
  //    Module._cache or setInterval; the known bad version does both.
  if (existsSync(indexJs)) {
    const src = readFileSync(indexJs, 'utf-8');
    if (src.includes('Module._cache') || src.includes('setInterval') || src.length > 2000) {
      problems.push('node_modules/electron/index.js is not the stock loader (patched/proxied)');
      if (fix) {
        mkdirSync(quarantine, { recursive: true });
        writeFileSync(path.join(quarantine, `electron-index-${Date.now()}.js.bak`), src);
        writeFileSync(indexJs, STOCK_INDEX);
        console.log('[doctor] restored stock node_modules/electron/index.js');
      }
    }
  }

  // 2. Planted app.asar overriding the CLI path argument.
  if (existsSync(plantedAsar)) {
    problems.push('stale app.asar in node_modules/electron/dist/resources/ overrides your source');
    if (fix) {
      mkdirSync(quarantine, { recursive: true });
      renameSync(plantedAsar, path.join(quarantine, `planted-app-${Date.now()}.asar`));
      console.log('[doctor] moved planted app.asar to .quarantine/');
    }
  }
}

// 3. Report only — the launcher strips this from the child environment.
if (process.env.ELECTRON_RUN_AS_NODE) {
  console.log('[doctor] note: ELECTRON_RUN_AS_NODE is set in this shell; the launcher will unset it');
}

if (problems.length === 0) {
  console.log('[doctor] electron install looks healthy');
} else if (!fix) {
  console.error('[doctor] problems found:');
  for (const p of problems) console.error('  - ' + p);
  console.error('[doctor] run: node scripts/doctor.mjs --fix');
  process.exit(1);
}
