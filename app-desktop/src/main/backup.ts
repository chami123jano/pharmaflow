/**
 * Automatic backups.
 *
 * Until now a backup happened only when someone pressed the button, which in a
 * busy shop means never. Now the database is copied to a dated file every day:
 * shortly after the app opens, then every hour while anything has changed, and
 * once more as it closes — so today's file always holds today's last sale.
 *
 * The default folder is Documents\PharmaFlow\Backups. On a PC where Documents
 * lives in OneDrive, that also puts a copy off the premises for free.
 *
 * One file per day (pharmaflow-YYYY-MM-DD.db), the newest 30 kept. Written to
 * a temporary name first and renamed, so a crash mid-copy never leaves a
 * half-written file where a good one was.
 */
import { app, dialog, shell, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from './db/index.js';
import log from './log.js';

const KEEP = 30;
const NAME = /^pharmaflow-\d{4}-\d{2}-\d{2}\.db$/;

function setting(key: string): string {
  try { return String((getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value || ''); } catch { return ''; }
}
function setSetting(key: string, value: string) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, value);
}

export function backupFolder(): string {
  return setting('backup.folder').trim() || path.join(app.getPath('documents'), 'PharmaFlow', 'Backups');
}
const dbFile = () => path.join(app.getPath('userData'), 'pharmaflow.db');
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD on the shop's clock

function listBackups(dir: string) {
  try {
    return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse()
      .map((f) => ({ name: f, path: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size }));
  } catch { return []; }
}

/**
 * Copies the database to today's file. Without `force`, does nothing when
 * today's file is already newer than the database — no change, no copy.
 */
export function backupNow(force = false): { ok: boolean; skipped?: boolean; file?: string; error?: string } {
  try {
    const dir = backupFolder();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `pharmaflow-${today()}.db`);
    if (!force && fs.existsSync(file) && fs.statSync(file).mtimeMs >= fs.statSync(dbFile()).mtimeMs) {
      return { ok: true, skipped: true, file };
    }
    // Settings first: writing them touches the database file, and the copy
    // must be taken after, or every check would see "changed since backup".
    const now = new Date().toISOString();
    setSetting('backup.last', now);
    setSetting('backup.last_file', file);
    setSetting('backup.last_error', '');
    const tmp = file + '.tmp';
    fs.copyFileSync(dbFile(), tmp);
    fs.renameSync(tmp, file);

    for (const old of listBackups(dir).slice(KEEP)) {
      try { fs.unlinkSync(old.path); } catch {}
    }
    log.info('[backup] saved', file);
    return { ok: true, file };
  } catch (err: any) {
    const msg = err?.message || String(err);
    try { setSetting('backup.last_error', msg); } catch {}
    log.error('[backup] failed', msg);
    return { ok: false, error: msg };
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startAutoBackup() {
  setTimeout(() => backupNow(), 60_000).unref?.();
  if (timer) clearInterval(timer);
  timer = setInterval(() => backupNow(), 60 * 60_000);
  (timer as any).unref?.();
}

ipcMain.handle('backup:status', () => {
  const dir = backupFolder();
  const files = listBackups(dir);
  return {
    ok: true,
    data: {
      folder: dir,
      isDefault: !setting('backup.folder').trim(),
      last: setting('backup.last') || null,
      lastError: setting('backup.last_error') || null,
      count: files.length,
      keep: KEEP,
      files: files.slice(0, 5).map((f) => ({ name: f.name, size: f.size })),
    },
  };
});

ipcMain.handle('backup:run', () => backupNow(true));

ipcMain.handle('backup:chooseFolder', async () => {
  const bw = BrowserWindow.getAllWindows()[0];
  const r = await dialog.showOpenDialog(bw, { title: 'Where should backups be kept?', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths?.length) return { ok: false, error: 'CANCELED' };
  setSetting('backup.folder', r.filePaths[0]);
  return { ok: true, data: backupNow(true) };
});

ipcMain.handle('backup:resetFolder', () => {
  setSetting('backup.folder', '');
  return { ok: true, data: backupNow(true) };
});

ipcMain.handle('backup:openFolder', async () => {
  const dir = backupFolder();
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return { ok: true };
});
