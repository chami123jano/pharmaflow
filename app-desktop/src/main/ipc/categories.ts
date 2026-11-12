/**
 * The shop's own categories, shared between the till, the other PC and the
 * website.
 *
 * They used to live only in this PC's settings, so a category added at the
 * shop never reached home or the phone. Adding and removing now travel as
 * events — `category.added` / `category.removed` — which merge cleanly: two
 * places adding categories at the same time both keep theirs, and a removal
 * only removes the one name. The website adds through the same event.
 *
 * Built-in categories are not stored here; the screens add them.
 */
import { ipcMain } from 'electron';
import { getDb } from '../db/index.js';
import { recordEvent } from '../sync/events.js';

const KEY = 'categories.custom';
export type Group = 'Medicines' | 'Shop items';
export interface Cat { name: string; group: Group }

export function readCustom(db: any): Cat[] {
  try {
    const v = (db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as any)?.value;
    const arr = JSON.parse(v || '[]');
    return Array.isArray(arr)
      ? arr.filter((c: any) => c && typeof c.name === 'string' && c.name.trim())
           .map((c: any) => ({ name: c.name.trim(), group: c.group === 'Shop items' ? 'Shop items' : 'Medicines' }))
      : [];
  } catch { return []; }
}

function write(db: any, list: Cat[]) {
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(KEY, JSON.stringify(list));
}

/** Adds by name, case-insensitively. Returns false when it was already there. */
export function addCategory(db: any, name: string, group: Group): boolean {
  const list = readCustom(db);
  if (list.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) return false;
  write(db, [...list, { name: name.trim(), group: group === 'Shop items' ? 'Shop items' : 'Medicines' }]);
  return true;
}

export function removeCategory(db: any, name: string): boolean {
  const list = readCustom(db);
  const next = list.filter((c) => c.name.toLowerCase() !== name.trim().toLowerCase());
  if (next.length === list.length) return false;
  write(db, next);
  return true;
}

const isAdmin = (db: any, userId?: string) =>
  String((userId ? (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role : '') || '').toLowerCase() === 'admin';

ipcMain.handle('categories:list', () => ({ ok: true, data: readCustom(getDb()) }));

ipcMain.handle('categories:add', (_e, name: string, group: Group, userId?: string) => {
  const db = getDb();
  if (!isAdmin(db, userId)) return { ok: false, error: 'FORBIDDEN', message: 'Only an admin can add categories' };
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) return { ok: false, error: 'NO_NAME' };
  if (addCategory(db, n, group)) recordEvent('category.added', { name: n, group, ts: new Date().toISOString() });
  return { ok: true, data: readCustom(db) };
});

ipcMain.handle('categories:remove', (_e, name: string, userId?: string) => {
  const db = getDb();
  if (!isAdmin(db, userId)) return { ok: false, error: 'FORBIDDEN', message: 'Only an admin can remove categories' };
  if (removeCategory(db, name)) recordEvent('category.removed', { name: String(name).trim(), ts: new Date().toISOString() });
  return { ok: true, data: readCustom(db) };
});

/** The letters this PC puts in front of the codes it makes. "W" is the website's. */
ipcMain.handle('sku:prefix', () => {
  const v = String((getDb().prepare("SELECT value FROM settings WHERE key = 'sku_prefix'").get() as any)?.value || 'LK-');
  return { ok: true, data: v.replace(/-+$/, '') || 'LK' };
});

ipcMain.handle('sku:setPrefix', (_e, letters: string, userId?: string) => {
  const db = getDb();
  if (!isAdmin(db, userId)) return { ok: false, error: 'FORBIDDEN', message: 'Only an admin can change this' };
  const p = String(letters || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!p || p.length > 4) return { ok: false, error: 'BAD', message: 'Use 1 to 4 letters or numbers' };
  if (p === 'W') return { ok: false, error: 'RESERVED', message: '"W" is kept for items added on the website' };
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('sku_prefix', ?)").run(p + '-');
  return { ok: true, data: p };
});

/**
 * Categories added before they were shared lived only on this PC. Send each
 * of them once, so the other PC and the website catch up.
 */
export function shareExistingOnce(db: any) {
  try {
    if ((db.prepare("SELECT value FROM settings WHERE key = 'categories.shared'").get() as any)?.value === '1') return;
    for (const c of readCustom(db)) recordEvent('category.added', { name: c.name, group: c.group, ts: new Date().toISOString() });
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('categories.shared','1')").run();
  } catch {}
}
