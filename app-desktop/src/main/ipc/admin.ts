import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import { getDb } from '../db/index.js';
import log from '../log.js';
import { recordEvent } from '../sync/events.js';
import { MEDICINES_LK } from '../data/medicines-lk.js';
import { recomputeStock } from '../db/batches.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Deletes every sale, for starting fresh after testing.
 *
 * Stock goes back the way every other change does — into the batch each line
 * came out of — never by writing products.stock, which is only a cache of the
 * batches and reverted the next time anything recomputed it. Cancelled bills
 * already gave their stock back when they were voided, and returned units
 * already went back when they were returned; neither is put back twice.
 * Bill numbers start again from 1.
 */
ipcMain.handle('admin:resetAllSales', () => {
  const db = getDb();
  const now = new Date().toISOString();
  const moves: any[] = [];
  const tx = db.transaction(() => {
    const items = db.prepare(`
      SELECT si.id, si.product_id, si.quantity, si.batch_id,
             COALESCE((SELECT SUM(ri.qty) FROM sale_return_items ri WHERE ri.sale_item_id = si.id AND ri.restocked = 1), 0) AS back
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.voided_at IS NULL
    `).all() as any[];
    const touched = new Set<string>();
    for (const it of items) {
      const qty = Number(it.quantity || 0) - Number(it.back || 0);
      if (qty <= 0) continue;
      if (!db.prepare('SELECT id FROM products WHERE id = ?').get(it.product_id)) continue;
      let batchId = it.batch_id && db.prepare('SELECT id FROM product_batches WHERE id = ?').get(it.batch_id) ? it.batch_id : null;
      if (batchId) {
        db.prepare('UPDATE product_batches SET qty_remaining = qty_remaining + ? WHERE id = ?').run(qty, batchId);
      } else {
        batchId = randomUUID();
        db.prepare(`INSERT INTO product_batches (id,product_id,batch_no,expiry,qty_received,qty_remaining,notes,created_at)
                    VALUES (?,?,?,?,?,?,?,?)`).run(batchId, it.product_id, 'RESET', null, qty, qty, 'Put back when all sales were deleted', now);
      }
      const movementId = randomUUID();
      db.prepare('INSERT INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(movementId, it.product_id, 'reset', qty, null, 'All sales deleted', null, now);
      moves.push({ product_id: it.product_id, delta: qty, batch_id: batchId, movement_id: movementId });
      touched.add(it.product_id);
    }
    for (const pid of touched) recomputeStock(db, pid);
    const count = db.prepare('SELECT COUNT(1) as c FROM sales').get() as any;
    db.prepare('DELETE FROM sale_return_items').run();
    db.prepare('DELETE FROM sale_returns').run();
    db.prepare('DELETE FROM sale_items').run();
    db.prepare('DELETE FROM sales').run();
    db.prepare('DELETE FROM receipt_seq').run();
    try { db.prepare("DELETE FROM sqlite_sequence WHERE name = 'receipt_seq'").run(); } catch {}
    return { restoredProducts: touched.size, salesDeleted: Number(count?.c || 0) };
  });
  try {
    const res = tx();
    // The other PC and the website learn about the stock as usual.
    for (const m of moves) recordEvent('stock.delta', { ...m, reason: 'reset', ts: now });
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
