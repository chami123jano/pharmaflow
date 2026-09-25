import { ipcMain } from 'electron';
import log from '../log.js';
import { getDb } from '../db/index.js';
import { randomUUID } from 'crypto';
import { recordEvent } from '../sync/events.js';
import { receiveBatch } from '../db/batches.js';

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

// Build a simple SKU base from product name and optional category
function buildSkuBase(name?: string, category?: string): string {
  const safe = (s?: string) => (s || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').trim();
  const parts: string[] = [];
  const cat = safe(category);
  if (cat) {
    // take up to first 3 letters of category words combined
    const cw = cat.split(/\s+/).map(w => w.replace(/[^A-Z0-9]/g, ''));
    const cbase = (cw[0] || '').slice(0, 3);
    if (cbase) parts.push(cbase);
  }
  const nm = safe(name);
  const words = nm.split(/\s+/).filter(Boolean);
  if (words.length) {
    // prefer letters from first 2 words, 3+2 letters
    const w1 = (words[0] || '').replace(/[^A-Z0-9]/g, '');
    const w2 = (words[1] || '').replace(/[^A-Z0-9]/g, '');
    let base = (w1.slice(0, 3) + (w2 ? w2.slice(0, 2) : '')).replace(/[^A-Z0-9]/g, '');
    if (!base) base = (w1 || 'PRD').slice(0, 3);
    parts.push(base);
    // If numeric token exists in name (e.g., 500MG), append its digits truncated
    const num = (nm.match(/\d+/g) || [])[0];
    if (num) parts.push(num.slice(0, 3));
  }
  const base = parts.filter(Boolean).join('-') || 'PRD';
  return base.slice(0, 12); // keep base reasonably short
}

// Generate a unique SKU with an incremental suffix if needed
function generateUniqueSku(name?: string, category?: string): string {
  const db = getDb();
  const base = buildSkuBase(name, category);
  // Determine prefix from settings, default to 'LK-'
  let prefix = 'LK-';
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('sku_prefix') as any;
    const v = (row?.value ?? '').toString().trim();
    if (v) prefix = v;
  } catch {}
  // Normalize prefix: uppercase, ensure ends with '-'
  prefix = prefix.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (prefix && !prefix.endsWith('-')) prefix = prefix + '-';
  const baseFull = `${prefix}${base}`;
  // Try plain prefixed base if not taken
  const exists = db.prepare('SELECT 1 FROM products WHERE sku = ?').get(baseFull) as any;
  if (!exists) return baseFull;
  // Find existing suffixes for this base pattern
  const like = `${baseFull}-%`;
  const rows = db.prepare('SELECT sku FROM products WHERE sku LIKE ?').all(like) as Array<{ sku: string }>;
  let maxN = 0;
  for (const r of rows) {
    const m = r.sku.match(new RegExp('^' + baseFull.replace(/[-/\\^$*+?.()|[\]{}]/g, r => `\\${r}`) + '-(\\d+)$'));
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  // Propose next
  const next = maxN + 1;
  const sku = `${baseFull}-${String(next).padStart(3, '0')}`;
  return sku;
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
    db.prepare('INSERT INTO products (id,name,sku,price,stock,expiry,description,supplier,created_at,updated_at,category,generic_name,barcode) VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?)')
      .run(id, name, finalSku, price, expiry || null, description, supplier, now, now, category,
           generic_name || null, (barcode ? String(barcode).trim() : null) || null);
    if (Number(stock) > 0) {
      try { receiveBatch(db, { product_id: id, qty: Number(stock), expiry: expiry || null, notes: 'Opening stock' }); } catch {}
    }
    recordEvent('product.upsert', { id, name, sku: finalSku, price, expiry: expiry || null,
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
  const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
  try {
    log.info('[IPC products:update] updating', { id, patch });
    db.prepare(`UPDATE products SET name=?, sku=?, price=?, stock=?, expiry=?, description=?, supplier=?, category=?, generic_name=?, barcode=?, updated_at=? WHERE id=?`)
      .run(merged.name, merged.sku, merged.price, merged.stock, merged.expiry || null, merged.description || null, merged.supplier || null, merged.category || null,
           merged.generic_name || null, merged.barcode || null, merged.updated_at, id);
    recordEvent('product.upsert', { id, name: merged.name, sku: merged.sku, price: merged.price,
      expiry: merged.expiry || null, description: merged.description || null, supplier: merged.supplier || null,
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


