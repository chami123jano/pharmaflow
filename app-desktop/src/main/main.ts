import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import log from './log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Pin the data folder before anything asks where it is.
 *
 * Electron names userData after the app, so renaming the product moves it —
 * and the database, every sale and every product go with it. They would still
 * be on disk, just invisible, which is the worst kind of loss. This name is an
 * internal identifier and must never change, whatever the shop is called.
 */
app.setName('pharmaflow-desktop');

import { initDb, getDb } from './db/index.js';
import './ipc/auth.js';
import './ipc/products.js';
import './ipc/sales.js';
import './ipc/reports.js';
import './ipc/settings.js';
import './ipc/admin.js';
import './ipc/pos.js';
import './ipc/batches.js';
import './ipc/contacts.js';
import './ipc/sync.js';
import { getDeviceId } from './sync/events.js';

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let windowWasCreated = false;

/**
 * Hidden windows used for printing. They are tracked so they can be torn down
 * with the main window — otherwise one left open holds the whole process open
 * with nothing visible, and the single-instance lock turns the next launch
 * into a no-op.
 */
const printWindows = new Set<InstanceType<typeof BrowserWindow>>();
function closePrintWindows() {
  for (const w of [...printWindows]) {
    try { w.destroy(); } catch {}
    printWindows.delete(w);
  }
}

/**
 * The shop's name for the window title, before the renderer has loaded.
 *
 * Falls back to the product name, so a fresh install still has a sensible
 * title and a database problem never leaves a blank title bar.
 */
function shopName(): string {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'pharmacy.name'").get() as any;
    const v = String(row?.value ?? '').trim();
    if (v) return v;
  } catch {}
  return 'PharmaFlow';
}

function isDev(): boolean {
  try { return !app.isPackaged; } catch { return true; }
}

let _winStateFile: string | null = null;
function getWinStateFile() {
  if (!_winStateFile) _winStateFile = path.join(app.getPath('userData'), 'window-state.json');
  return _winStateFile;
}
function loadWinState() {
  try { return JSON.parse(fs.readFileSync(getWinStateFile(), 'utf-8')); } catch { return {}; }
}
function saveWinState(win: InstanceType<typeof BrowserWindow>) {
  try {
    const b = win.getBounds();
    fs.writeFileSync(getWinStateFile(), JSON.stringify({ ...b, isMaximized: win.isMaximized() }));
  } catch {}
}

/**
 * Staff lockdown.
 *
 * When the shop turns this on, closing the window asks for an admin password
 * instead of quitting. The renderer runs the prompt, so it is styled like the
 * rest of the app — the main process only gates the close.
 *
 * Deliberately off by default. Nobody should be locked into a till they did
 * not ask to be locked into, least of all on the machine it is built on.
 */
let exitApproved = false;

function lockdownOn(): boolean {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'security.lock_exit'").get() as any;
    const v = String(row?.value ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  } catch {
    // If the setting cannot be read, let the window close. Failing shut would
    // leave an app nobody can quit.
    return false;
  }
}

function kioskOn(): boolean {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'security.kiosk'").get() as any;
    const v = String(row?.value ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  } catch { return false; }
}

async function createWindow() {
  const ws = loadWinState();
  mainWindow = new BrowserWindow({
    x: ws.x, y: ws.y,
    width: ws.width || 1280,
    height: ws.height || 820,
    minWidth: 960, minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '../preload/index.cjs'),
    },
    show: false,
    title: shopName(),
  });
  if (ws.isMaximized) mainWindow.maximize();

  // Subscribe before loading. The window is created with show:false, and
  // ready-to-show fires during the load — registering the listener after
  // awaiting the load races it, and when it loses, the window never appears.
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (isDev()) {
    await mainWindow.loadURL((process.env.VITE_DEV_URL || 'http://localhost:5173') + '/#/');
    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  windowWasCreated = true;
  // Belt and braces: if ready-to-show already fired, show it now.
  if (mainWindow && !mainWindow.isVisible()) mainWindow.show();

  if (kioskOn()) {
    try {
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setKiosk(true);
    } catch (err: any) {
      log.error('[Lockdown] could not enter kiosk mode', err?.message || err);
    }
  }
  mainWindow.on('close', (e) => {
    // Alt+F4 and the X button both arrive here, so gating this one event
    // covers every way a cashier can try to leave.
    if (lockdownOn() && !exitApproved) {
      e.preventDefault();
      try { mainWindow?.webContents.send('app:exit-requested'); } catch {}
      return;
    }
    if (mainWindow) saveWinState(mainWindow);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Closing the main window means the user is finished, so quit from here
    // rather than waiting for window-all-closed. A print window showing a
    // native dialog still counts as open and cannot always be destroyed while
    // that dialog is up, so window-all-closed may never fire — which left the
    // process running with nothing on screen. With the single-instance lock in
    // place the next launch then did nothing at all, and the till would not
    // start. Force the exit if a graceful quit has not taken hold.
    closePrintWindows();
    if (process.platform !== 'darwin') {
      app.quit();
      setTimeout(() => { try { app.exit(0); } catch {} }, 2000).unref?.();
    }
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    log.error('[Renderer] Load failed:', code, desc);
    try { dialog.showErrorBox('Load Failed', `${desc} (${code})`); } catch {}
  });
  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    log.error('[Renderer] Crashed:', d);
    try { dialog.showErrorBox('Renderer Crashed', d?.reason || 'unknown'); } catch {}
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function bootstrap() {
  await initDb();
  // Settle the device id now, while nothing else is mid-write.
  try { log.info('[App] device:', getDeviceId()); } catch {}
  log.info('[App] userData:', app.getPath('userData'));
  await createWindow();
  ipcMain.handle('util:restartApp', async () => {
    try { app.relaunch(); app.exit(0); return true; } catch { return false; }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && windowWasCreated) {
      closePrintWindows();
      app.quit();
      // A native print dialog left open can wedge the shutdown: the windows are
      // gone but the process stays, and because of the single-instance lock the
      // next launch then does nothing at all. Rather than leave the till unable
      // to start, force the exit if a graceful quit has not taken hold.
      setTimeout(() => { try { app.exit(0); } catch {} }, 3000).unref?.();
    }
  });
  app.on('before-quit', closePrintWindows);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.whenReady().then(bootstrap).catch((err: any) => {
    log.error('[App] Failed to start:', err?.message || err);
  });
}

/**
 * Called once the renderer has checked an admin password. The flag is the only
 * way past the close gate, and it is cleared straight after so one approval
 * cannot be reused later.
 */
ipcMain.handle('app:approveExit', () => {
  exitApproved = true;
  log.info('[Lockdown] exit approved');
  setTimeout(() => {
    try { mainWindow?.close(); } catch {}
    setTimeout(() => { exitApproved = false; }, 5000);
  }, 50);
  return { ok: true };
});

/** Whether the till is locked down, for the renderer to reflect in the UI. */
ipcMain.handle('app:lockState', () => {
  return { ok: true, data: { lockExit: lockdownOn(), kiosk: kioskOn() } };
});

/** Kiosk can be turned on and off without restarting. */
ipcMain.handle('app:setKiosk', (_e, on: boolean) => {
  try {
    if (!mainWindow) return { ok: false, error: 'NO_WINDOW' };
    mainWindow.setMenuBarVisibility(!on);
    mainWindow.setKiosk(!!on);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'KIOSK_FAILED' };
  }
});

ipcMain.handle('util:exportCSV', async (_e, suggested: string, data: string) => {
  if (!mainWindow) return false;
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggested, filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, data, 'utf-8');
  return true;
});

/**
 * Printers that produce a file rather than paper. Every one of them opens a
 * "save as" dialog even when asked to print silently, so none may be chosen
 * automatically — a till that stops to ask for a filename after every sale is
 * worse than one that does not print.
 */
const VIRTUAL_PRINTER = /(print to pdf|xps document writer|onenote|fax|adobe pdf|pdfcreator|cutepdf|foxit.*pdf|save as pdf|pdf24|bullzip)/i;

function isVirtualPrinter(name: string): boolean {
  return VIRTUAL_PRINTER.test(String(name || ''));
}

/**
 * Renders the receipt in a hidden window and prints it.
 *
 * Returns why it failed rather than a bare false — a receipt that silently
 * does not print is worse than one that says the printer is missing.
 */
ipcMain.handle('util:printHTML', async (_e, html: string) => {
  let win: InstanceType<typeof BrowserWindow> | null = null;
  try {
    // The window title is what Windows shows in the print dialog. Without it
    // the cashier sees "Electron - Print" on every receipt.
    win = new BrowserWindow({
      show: false,
      title: shopName() + ' Receipt',
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    printWindows.add(win);
    win.on('closed', () => { if (win) printWindows.delete(win); });
    // print() is called straight after the load resolves. Waiting on
    // did-finish-load here does not work: the event fires during loadURL, so a
    // listener attached afterwards never runs and nothing is ever printed.
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html || ''));

    let deviceName: string | undefined;
    let silent = false;
    let configuredName = '';
    try {
      const db = getDb();
      const nameRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('printer.receipt.name') as any;
      const silRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('printer.receipt.silent') as any;
      configuredName = (nameRow?.value || '').trim();
      const s = String(silRow?.value || '').trim().toLowerCase();
      // Receipts print silently unless explicitly switched off. Beyond being
      // what a counter wants, the Windows print dialog is a native modal run on
      // the main thread: if it is still up when the app closes, the process is
      // left wedged with no window, and the single-instance lock then stops the
      // app starting again at all. No JavaScript runs during that dialog, so it
      // cannot be recovered from — it has to be avoided.
      silent = s === '' ? true : !(s === '0' || s === 'false' || s === 'no');
    } catch { silent = true; }

    const printers = await win.webContents.getPrintersAsync();
    if (!printers.length) {
      win.destroy(); printWindows.delete(win);
      return { ok: false, error: 'NO_PRINTERS', message: 'Windows reports no installed printer.' };
    }
    if (!configuredName) {
      // Nothing chosen in Settings yet. Prefer a real printer over the Windows
      // default, because the default here is often "Microsoft Print to PDF",
      // which stops to ask for a filename on every single sale.
      const real = printers.filter((p) => !isVirtualPrinter(p.name) && !isVirtualPrinter((p as any).displayName));
      const pick = real.find((p) => (p as any).isDefault) || real[0] || printers.find((p) => (p as any).isDefault);
      if (pick) deviceName = pick.name;
      if (pick && isVirtualPrinter(pick.name)) {
        log.info('[Print] only file-based printers are installed; a save dialog is unavoidable');
      }
    } else {
      const m = printers.find((p) => p.name === configuredName || (p as any).displayName === configuredName);
      if (!m) {
        win.destroy(); printWindows.delete(win);
        return {
          ok: false, error: 'PRINTER_NOT_FOUND',
          message: `The receipt printer "${configuredName}" is not connected. Change it in Settings.`,
        };
      }
      deviceName = m.name;
    }

    // A receipt is a narrow strip, so drop the default page margins — on roll
    // paper they waste several centimetres at the top of every bill.
    const opts: any = { silent, printBackground: true, margins: { marginType: 'none' } };
    if (deviceName) opts.deviceName = deviceName;

    const result = await new Promise<{ ok: boolean; error?: string; message?: string }>((resolve) => {
      // Only guard silent prints with a timer. When the Windows print dialog is
      // shown the cashier may take as long as they like to choose a printer —
      // timing that out cancels a print the person was in the middle of making.
      const timer = silent
        ? setTimeout(
            () => resolve({ ok: false, error: 'TIMEOUT', message: 'The printer did not respond.' }),
            60000
          )
        : null;
      try {
        win!.webContents.print(opts, (success, failureReason) => {
          if (timer) clearTimeout(timer);
          if (success) return resolve({ ok: true });
          // Cancelling the Windows print dialog lands here and is not a fault.
          const cancelled = /cancel/i.test(failureReason || '');
          resolve({
            ok: false,
            error: cancelled ? 'CANCELLED' : 'PRINT_FAILED',
            message: cancelled ? 'Printing was cancelled.' : failureReason || 'The printer refused the job.',
          });
        });
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        resolve({ ok: false, error: 'PRINT_THREW', message: err?.message || 'Could not start printing.' });
      }
    });

    try { win.destroy(); } catch {}
    printWindows.delete(win);
    if (!result.ok && result.error !== 'CANCELLED') log.error('[Print] failed:', result.error, result.message);
    return result;
  } catch (err: any) {
    try { if (win) { win.destroy(); printWindows.delete(win); } } catch {}
    log.error('[Print] failed to prepare', err?.message || err);
    return { ok: false, error: 'PREPARE_FAILED', message: err?.message || 'Could not prepare the receipt.' };
  }
});

/**
 * Writes a copy of the receipt to disk as PDF.
 *
 * Filed under Documents/PharmaFlow/Receipts/YYYY-MM so a year of trading does
 * not end up in one directory. printToPDF is used rather than the print path
 * because it never shows a dialog.
 *
 * A failure here is reported but must not stop a sale — the money has already
 * changed hands, and losing the sale to save a file would be the wrong trade.
 */
ipcMain.handle('util:saveReceiptPDF', async (_e, html: string, filename: string) => {
  let win: InstanceType<typeof BrowserWindow> | null = null;
  try {
    let folder = '';
    try {
      const row = getDb().prepare("SELECT value FROM settings WHERE key = 'receipts.folder'").get() as any;
      folder = (row?.value || '').trim();
    } catch {}
    if (!folder) folder = path.join(app.getPath('documents'), 'PharmaFlow', 'Receipts');

    const month = new Date().toISOString().slice(0, 7);
    const dir = path.join(folder, month);
    fs.mkdirSync(dir, { recursive: true });

    const safe = String(filename || 'receipt').replace(/[^A-Za-z0-9._-]/g, '_');
    const file = path.join(dir, safe.endsWith('.pdf') ? safe : safe + '.pdf');

    win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    printWindows.add(win);
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html || ''));

    // 80mm roll width, with the height left to grow with the content.
    const pdf = await win.webContents.printToPDF({
      pageSize: { width: 80000, height: 200000 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
    });
    fs.writeFileSync(file, pdf);

    win.destroy(); printWindows.delete(win);
    log.info('[Receipt] saved', file);
    return { ok: true, data: { path: file } };
  } catch (err: any) {
    try { if (win) { win.destroy(); printWindows.delete(win); } } catch {}
    log.error('[Receipt] could not save PDF', err?.message || err);
    return { ok: false, error: 'SAVE_FAILED', message: err?.message || 'Could not save the receipt copy.' };
  }
});

ipcMain.handle('util:listPrinters', async () => {
  const bw = BrowserWindow.getAllWindows()[0] || mainWindow;
  if (!bw) return [];
  try {
    return (await bw.webContents.getPrintersAsync()).map(p => ({
      name: p.name, displayName: (p as any).displayName || p.name, isDefault: (p as any).isDefault || false,
    }));
  } catch { return []; }
});

ipcMain.handle('dev:dbStatus', () => {
  try {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r: any) => r.name);
    return { ok: true, tables, hasUsers: tables.includes('users') };
  } catch (err: any) { return { ok: false, error: err?.message }; }
});
