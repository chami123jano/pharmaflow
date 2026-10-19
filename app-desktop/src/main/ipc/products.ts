import { ipcMain } from 'electron';
import log from '../log.js';
import { getDb } from '../db/index.js';
import { randomUUID } from 'crypto';
import { recordEvent } from '../sync/events.js';
import { receiveBatch } from '../db/batches.js';
import { generateUniqueSku } from '../db/sku.js';
import { parseCost } from '../db/cost.js';

// Ensure optional columns exist even if migrations haven't run yet (defensive)
let ensuredExtraCols = false;
function ensureProductExtraColumns() {
  if (ensuredExtraCols) return;
  const db = getDb();
  try {
    const cols = db.prepare("PRAGMA table_info('products')").all() as Array<{ name: string }>;
    const names = new Set(cols.map(c => c.name));
    if (!names.has('description')) {
      try { db.prepare('ALTER TABLE products ADD COLUMN description TEXT').run(); } catch {}
    }
    if (!names.has('supplier')) {
      try { db.prepare('ALTER TABLE products ADD COLUMN supplier TEXT').run(); } catch {}
    }
    // Some parts of the app use category; keep it if not present
    if (!names.has('category')) {
      try { db.prepare('ALTER TABLE products ADD COLUMN category TEXT').run(); } catch {}
    }
    // Generic name lets the counter find a brand by its active ingredient —
    // typing "paracetamol" should surface Panadol.
    if (!names.has('generic_name')) {
      try { db.prepare('ALTER TABLE products ADD COLUMN generic_name TEXT').run(); } catch {}
    }
    // Scanned barcode. Distinct from SKU, which is generated internally.
    if (!names.has('barcode')) {
      try { db.prepare('ALTER TABLE products ADD COLUMN barcode TEXT').run(); } catch {}
    }
  } finally {
    ensuredExtraCols = true;
  }
}


ipcMain.handle('products:list', () => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
  return { ok: true, data: rows };
});

ipcMain.handle('products:get', (_e, id: string) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  return { ok: true, data: row };
});

// Provide a SKU suggestion based on name/category that's unique in DB
ipcMain.handle('products:generateSku', (_e, payload?: { name?: string; category?: string }) => {
  try {
    const name = payload?.name;
    const category = payload?.category;
    const sku = generateUniqueSku(name, category);
    return { ok: true, data: { sku } };
  } catch (err: any) {
    log.error('[IPC products:generateSku] failed', err);
    return { ok: false, error: err?.message || 'GEN_SKU_FAILED' };
  }
});

ipcMain.handle('products:create', (_e, payload: any) => {
  ensureProductExtraColumns();
  const { name, sku, price, stock = 0, expiry, description = null, supplier = null, category = null,
          generic_name = null, barcode = null } = payload;
  if (!name || price == null) return { ok: false, error: 'VALIDATION' };
  const cost = parseCost(payload?.cost_price);
  if (cost === 'INVALID') return { ok: false, error: 'INVALID_COST', message: 'Cost price must be a number, zero or more' };
  const db = getDb();
  // Auto-generate SKU if missing/empty
  const finalSku = (typeof sku === 'string' && sku.trim()) ? String(sku).trim().toUpperCase() : generateUniqueSku(name, category || description || undefined);
  const exist = db.prepare('SELECT 1 FROM products WHERE sku = ?').get(finalSku);
  if (exist) return { ok: false, error: 'SKU_EXISTS' };
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    log.info('[IPC products:create] inserting', { id, sku: finalSku, name, price, stock, expiry, description, supplier, category });
    // Stock is owned by the batches, so the product starts at zero and any
    // opening quantity arrives as a batch below. Writing it here as well would
    // double-count once recomputeStock runs.
    db.prepare('INSERT INTO products (id,name,sku,price,cost_price,stock,expiry,description,supplier,created_at,updated_at,category,generic_name,barcode) VALUES (?,?,?,?,?,0,?,?,?,?,?,?,?,?)')
      .run(id, name, finalSku, price, cost, expiry || null, description, supplier, now, now, category,
           generic_name || null, (barcode ? String(barcode).trim() : null) || null);
    if (Number(stock) > 0) {
      try { receiveBatch(db, { product_id: id, qty: Number(stock), expiry: expiry || null, cost_price: cost, notes: 'Opening stock' }); } catch {}
    }
    recordEvent('product.upsert', { id, name, sku: finalSku, price, cost_price: cost, expiry: expiry || null,
      description, supplier, category, generic_name: generic_name || null,
      barcode: barcode || null, created_at: now, updated_at: now });
    // Opening stock travels as its own delta so it can never overwrite a
    // quantity the other machine changed in the meantime.
    if (Number(stock) > 0) recordEvent('stock.delta', { product_id: id, delta: Number(stock), reason: 'initial', ts: now });
    return { ok: true, data: { id, sku: finalSku } };
  } catch (err: any) {
    log.error('[IPC products:create] failed', err);
    return { ok: false, error: err?.message || 'INSERT_FAILED' };
  }
});

ipcMain.handle('products:update', (_e, id: string, patch: any) => {
  ensureProductExtraColumns();
  const db = getDb();
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return { ok: false, error: 'NOT_FOUND' };
  /**
   * Stock is not editable here, whatever the caller sends.
   *
   * `products.stock` is a cache of the sum of the batches, and every sale or
   * delivery recomputes it. Writing a number into it looked like it worked and
   * then silently reverted the moment anything else touched the product — the
   * quantity typed in simply vanished. Worse, in between, the shelf count on
   * screen disagreed with what the till could actually sell.
   *
   * Stock changes by receiving a delivery or adjusting a batch. Nowhere else.
   */
  const { stock: _ignoredStock, ...safePatch } = patch || {};
  if ('cost_price' in safePatch) {
    const cost = parseCost(safePatch.cost_price);
    if (cost === 'INVALID') return { ok: false, error: 'INVALID_COST', message: 'Cost price must be a number, zero or more' };
    safePatch.cost_price = cost;
  }
  const merged: any = { ...(existing as any), ...safePatch, updated_at: new Date().toISOString() };
  try {
    log.info('[IPC products:update] updating', { id, patch: safePatch });
    db.prepare(`UPDATE products SET name=?, sku=?, price=?, cost_price=?, expiry=?, description=?, supplier=?, category=?, generic_name=?, barcode=?, updated_at=? WHERE id=?`)
      .run(merged.name, merged.sku, merged.price, merged.cost_price ?? null, merged.expiry || null, merged.description || null, merged.supplier || null, merged.category || null,
           merged.generic_name || null, merged.barcode || null, merged.updated_at, id);
    recordEvent('product.upsert', { id, name: merged.name, sku: merged.sku, price: merged.price,
      cost_price: merged.cost_price ?? null, expiry: merged.expiry || null, description: merged.description || null, supplier: merged.supplier || null,
      category: merged.category || null, generic_name: merged.generic_name || null,
      barcode: merged.barcode || null, updated_at: merged.updated_at });
    return { ok: true };
  } catch (err: any) {
    log.error('[IPC products:update] failed', err);
    return { ok: false, error: err?.message || 'UPDATE_FAILED' };
  }
});

ipcMain.handle('products:delete', (_e, id: string) => {
  const db = getDb();
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    recordEvent('product.delete', { id });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'DELETE_FAILED' };
  }
});

ipcMain.handle('products:adjustStock', (_e, id: string, delta: number) => {
  const db = getDb();
  try {
    const qty = Number(delta);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      return { ok: false, error: 'INVALID_QUANTITY' };
    }
    const row = db.prepare('SELECT stock FROM products WHERE id = ?').get(id) as any;
    if (!row) return { ok: false, error: 'NOT_FOUND' };
    const current = Number(row.stock || 0);
    const now = new Date().toISOString();
    // Quick restock still creates a batch, just without an expiry date. Batches
    // with no date are drawn last, after everything with a known expiry.
    const batch = receiveBatch(db, { product_id: id, qty, notes: 'Quick restock' });
    const newStock = Number((db.prepare('SELECT stock FROM products WHERE id = ?').get(id) as any)?.stock ?? current + qty);
    log.info('[IPC products:adjustStock]', { id, current, qty, newStock });
    const movementId = randomUUID();
    try {
      db.prepare('INSERT INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(movementId, id, 'restock', qty, batch.id, null, null, now);
    } catch {}
    recordEvent('stock.delta', { product_id: id, delta: qty, reason: 'restock', movement_id: movementId, ts: now });
    return { ok: true, stock: newStock, data: { id, stock: newStock } };
  } catch (err: any) {
    log.error('[IPC products:adjustStock] failed', err);
    return { ok: false, error: err?.message || 'ADJUST_FAILED' };
  }
});


