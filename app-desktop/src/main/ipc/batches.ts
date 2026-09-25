/**
 * Receiving deliveries and looking at what is on the shelf by expiry date.
 */
import { ipcMain } from 'electron';
import { getDb } from '../db/index.js';
import { randomUUID } from 'crypto';
import log from '../log.js';
import { recordEvent } from '../sync/events.js';
import { receiveBatch, recomputeStock, isExpired, StockError } from '../db/batches.js';

ipcMain.handle('batches:list', (_e, productId: string) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT * FROM product_batches WHERE product_id = ?
      ORDER BY CASE WHEN expiry IS NULL OR expiry = '' THEN 1 ELSE 0 END, expiry ASC, created_at ASC
    `).all(productId) as any[];
    return { ok: true, data: rows.map((b) => ({ ...b, expired: isExpired(b.expiry) })) };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'LIST_FAILED' };
  }
});

/** Everything with stock left, soonest expiry first — the reorder/checking view. */
ipcMain.handle('batches:expiring', (_e, days = 90) => {
  const db = getDb();
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + Number(days || 90));
    const cut = cutoff.toISOString().slice(0, 10);
    const rows = db.prepare(`
      SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.price AS price
      FROM product_batches b JOIN products p ON p.id = b.product_id
      WHERE b.qty_remaining > 0 AND b.expiry IS NOT NULL AND b.expiry <> '' AND b.expiry <= ?
      ORDER BY b.expiry ASC
    `).all(cut) as any[];
    return {
      ok: true,
      data: rows.map((b) => ({
        ...b,
        expired: isExpired(b.expiry),
        value_at_risk: Number(b.qty_remaining || 0) * Number(b.price || 0),
      })),
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'EXPIRING_FAILED' };
  }
});

ipcMain.handle('batches:receive', (_e, payload: {
  product_id: string; qty: number; expiry?: string; batch_no?: string;
  cost_price?: number; supplier?: string; supplier_id?: string; created_by?: string;
}) => {
  const db = getDb();
  try {
    const batch = receiveBatch(db, {
      product_id: payload.product_id,
      qty: Number(payload.qty),
      expiry: payload.expiry || null,
      batch_no: payload.batch_no || null,
      cost_price: payload.cost_price ?? null,
      supplier: payload.supplier || null,
      created_by: payload.created_by || null,
    });
    if (payload.supplier_id) {
      try { db.prepare('UPDATE product_batches SET supplier_id = ? WHERE id = ?').run(payload.supplier_id, batch.id); } catch {}
    }
    const now = new Date().toISOString();
    const movementId = randomUUID();
    try {
      db.prepare('INSERT INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(movementId, payload.product_id, 'restock', batch.qty_received, batch.id,
             batch.expiry ? 'expires ' + batch.expiry : null, payload.created_by || null, now);
    } catch {}
    // Travels as a delta like every other stock change, so a delivery entered
    // at home and a sale at the shop both survive the merge.
    recordEvent('stock.delta', {
      product_id: payload.product_id, delta: batch.qty_received, reason: 'restock',
      movement_id: movementId, batch_id: batch.id, expiry: batch.expiry, batch_no: batch.batch_no, ts: now,
    });
    log.info('[IPC batches:receive]', { product: payload.product_id, qty: batch.qty_received, expiry: batch.expiry });
    return { ok: true, data: batch };
  } catch (err: any) {
    if (err instanceof StockError) return { ok: false, error: err.code, message: err.message };
    log.error('[IPC batches:receive] failed', err);
    return { ok: false, error: err?.message || 'RECEIVE_FAILED' };
  }
});

/**
 * Corrects a batch's remaining quantity — for damage, or a miscount.
 * The difference is recorded as a movement so the change is auditable.
 */
ipcMain.handle('batches:adjust', (_e, batchId: string, newQty: number, reason?: string, userId?: string) => {
  const db = getDb();
  try {
    const b = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(batchId) as any;
    if (!b) return { ok: false, error: 'NOT_FOUND' };
    const qty = Number(newQty);
    if (!Number.isInteger(qty) || qty < 0) return { ok: false, error: 'INVALID_QUANTITY' };

    const delta = qty - Number(b.qty_remaining || 0);
    const now = new Date().toISOString();
    db.prepare('UPDATE product_batches SET qty_remaining = ? WHERE id = ?').run(qty, batchId);
    recomputeStock(db, b.product_id);

    if (delta !== 0) {
      const movementId = randomUUID();
      try {
        db.prepare('INSERT INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(movementId, b.product_id, 'adjust', delta, batchId, reason || null, userId || null, now);
      } catch {}
      recordEvent('stock.delta', { product_id: b.product_id, delta, reason: 'adjust', movement_id: movementId, batch_id: batchId, ts: now });
    }
    return { ok: true, data: { id: batchId, qty_remaining: qty } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'ADJUST_FAILED' };
  }
});
