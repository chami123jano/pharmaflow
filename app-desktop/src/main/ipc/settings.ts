import { ipcMain } from 'electron';
import { getDb } from '../db/index.js';

ipcMain.handle('settings:get', (_e, key: string) => {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return { ok: true, value: row?.value ?? null };
});

ipcMain.handle('settings:set', (_e, key: string, value: string) => {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, value);
  return { ok: true };
});

ipcMain.handle('settings:list', () => {
  const db = getDb();
  const rows = db.prepare('SELECT key,value FROM settings ORDER BY key').all();
  return { ok: true, data: rows };
});

