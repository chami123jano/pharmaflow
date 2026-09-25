/**
 * Electron API shim for dev-mode CJS builds.
 *
 * In Electron's startup, browser_init.js runs BEFORE our app code and populates
 * Module._cache['electron'] with the real API (app, BrowserWindow, ipcMain, …).
 * It also patches Module._resolveFilename so that 'electron' → 'electron' (the
 * cache key). But if that hasn't kicked in yet (timing issue) we fall back to
 * reading the cache entry directly.
 *
 * In a packaged build the npm electron package is not present, so 'electron'
 * resolves via Electron's own registry and this shim is never reached.
 */
'use strict';

const Module = require('module');

// Try the direct cache entry first (set by browser_init's makeElectronModule)
let api = Module._cache['electron'] && Module._cache['electron'].exports;

// If not yet populated, trigger _resolveFilename patch by accessing it
if (!api || typeof api !== 'object') {
  // Try electron/main (the sub-path browser_init registers)
  const mainEntry = Module._cache['electron/main'];
  if (mainEntry) {
    api = mainEntry.exports;
  }
}

// Last resort: try process._linkedBinding to build minimal API set
if (!api || typeof api !== 'object') {
  try {
    const appBinding = process._linkedBinding('electron_browser_app');
    const ipcBinding = process._linkedBinding('electron_browser_ipc_main');
    const bwBinding = process._linkedBinding('electron_browser_base_window');
    const dialogBinding = process._linkedBinding('electron_browser_dialog');
    const shellBinding = process._linkedBinding('electron_browser_shell');
    api = {
      app: appBinding && appBinding.app,
      ipcMain: ipcBinding,
      BrowserWindow: bwBinding,
      dialog: dialogBinding,
      shell: shellBinding,
    };
  } catch (_) {
    // Will be set later; export empty object that will be populated
    api = {};
  }
}

module.exports = api;
