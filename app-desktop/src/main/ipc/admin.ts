import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import { getDb } from '../db/index.js';
import log from '../log.js';
import { recordEvent } from '../sync/events.js';
import { MEDICINES_LK } from '../data/medicines-lk.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

ipcMain.handle('admin:resetAllSales', () => {
  const db = getDb();
  const tx = db.transaction(() => {
    const items = db.prepare('SELECT product_id, quantity FROM sale_items').all() as any[];
    let restored = 0;
    for (const it of items) {
      const row = db.prepare('SELECT stock FROM products WHERE id = ?').get(it.product_id) as any;
      if (!row) continue;
      db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?')
        .run(Number(row.stock || 0) + Number(it.quantity || 0), new Date().toISOString(), it.product_id);
      restored++;
    }
    const count = db.prepare('SELECT COUNT(1) as c FROM sales').get() as any;
    db.prepare('DELETE FROM sales').run();
    return { restoredProducts: restored, salesDeleted: Number(count?.c || 0) };
  });
  try {
    const res = tx();
    log.info('[ADMIN resetAllSales] success', res);
    return { ok: true, data: res };
  } catch (err: any) {
    log.error('[ADMIN resetAllSales] failed', err);
    return { ok: false, error: err?.message || 'RESET_FAILED' };
  }
});

ipcMain.handle('admin:seedCommonProductsLK', () => {
  const db = getDb();
  // Older databases predate these columns; add them before writing.
  try {
    const cols = db.prepare("PRAGMA table_info('products')").all() as any[];
    const have = new Set(cols.map((c: any) => c.name));
    for (const col of ['category', 'description', 'supplier', 'generic_name', 'barcode']) {
      if (!have.has(col)) try { db.prepare(`ALTER TABLE products ADD COLUMN ${col} TEXT`).run(); } catch {}
    }
  } catch {}

  const now = new Date().toISOString();
  let inserted = 0, enriched = 0, skipped = 0;

  for (const m of MEDICINES_LK) {
    try {
      const existing = db.prepare('SELECT id, generic_name, category FROM products WHERE sku = ? OR lower(name) = lower(?)')
        .get(m.sku, m.name) as any;

      if (existing) {
        // Never touch price or stock of a product the pharmacy already has —
        // re-seeding used to overwrite both, wiping real prices and counts.
        // Only fill in details that are still blank.
        const needsGeneric = !existing.generic_name;
        const needsCategory = !existing.category;
        if (needsGeneric || needsCategory) {
          db.prepare(`UPDATE products SET generic_name = COALESCE(NULLIF(generic_name, ''), ?), category = COALESCE(NULLIF(category, ''), ?), updated_at = ? WHERE id = ?`)
            .run(m.generic || null, m.cat, now, existing.id);
          enriched++;
        } else {
          skipped++;
        }
        continue;
      }

      // New products arrive unpriced and with no stock. Sri Lankan retail
      // prices are regulated and change, so the pharmacy sets its own; a
      // product priced 0 cannot be sold until someone enters a real price.
      const id = randomUUID();
      db.prepare('INSERT INTO products (id,name,sku,price,stock,category,generic_name,created_at,updated_at) VALUES (?,?,?,0,0,?,?,?,?)')
        .run(id, m.name, m.sku, m.cat, m.generic || null, now, now);
      recordEvent('product.upsert', {
        id, name: m.name, sku: m.sku, price: 0, category: m.cat,
        generic_name: m.generic || null, created_at: now, updated_at: now,
      });
      inserted++;
    } catch {}
  }

  log.info('[ADMIN] Seed:', { inserted, enriched, skipped, total: MEDICINES_LK.length });
  return { ok: true, data: { inserted, enriched, skipped, total: MEDICINES_LK.length } };
});

ipcMain.handle('admin:resetLocalDb', async () => {
  try {
    const userData = app.getPath('userData');
    const dbPath = path.join(userData, 'pharmaflow.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    log.info('[ADMIN] Database deleted at', dbPath);
    return { ok: true, data: { dbPath, deleted: true } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'RESET_FAILED' };
  }
});

ipcMain.handle('admin:backupDb', async () => {
  try {
    const bw = BrowserWindow.getAllWindows()[0];
    const userData = app.getPath('userData');
    const dbPath = path.join(userData, 'pharmaflow.db');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const res = await dialog.showSaveDialog(bw || new BrowserWindow({ show: false }), {
      defaultPath: `pharmaflow-backup-${ts}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, error: 'CANCELED' };
    fs.copyFileSync(dbPath, res.filePath);
    log.info('[ADMIN backupDb] Saved backup to', res.filePath);
    return { ok: true, data: { filePath: res.filePath } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'BACKUP_FAILED' };
  }
});

ipcMain.handle('admin:restoreDb', async () => {
  try {
    const bw = BrowserWindow.getAllWindows()[0];
    const open = await dialog.showOpenDialog(bw || new BrowserWindow({ show: false }), {
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
      properties: ['openFile'],
    });
    if (open.canceled || !open.filePaths?.length) return { ok: false, error: 'CANCELED' };
    const userData = app.getPath('userData');
    const restorePath = path.join(userData, 'pharmaflow.db.restore');
    fs.copyFileSync(open.filePaths[0], restorePath);
    return { ok: true, data: { stagedPath: restorePath, needsRestart: true } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'RESTORE_FAILED' };
  }
});
