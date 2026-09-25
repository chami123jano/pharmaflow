/**
 * Counter-side operations that are not part of ringing up a sale:
 * holding a bill so the queue keeps moving, and voiding one that was wrong.
 */
import { ipcMain } from 'electron';
import { getDb } from '../db/index.js';
import { randomUUID } from 'crypto';
import log from '../log.js';
import { recordEvent } from '../sync/events.js';
import { restoreAllocation, recomputeStock } from '../db/batches.js';

/* ---------------------------------------------------------------- held bills */

ipcMain.handle('pos:hold', (_e, payload: { label?: string; cart: any[]; total?: number; cashier_id?: string }) => {
  const { label, cart, total = 0, cashier_id } = payload || ({} as any);
  if (!Array.isArray(cart) || cart.length === 0) return { ok: false, error: 'EMPTY_CART' };
  const db = getDb();
  const id = randomUUID();
  try {
    db.prepare('INSERT INTO held_sales (id,label,payload,item_count,total,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, label || null, JSON.stringify(cart), cart.length, Number(total) || 0, cashier_id || null, new Date().toISOString());
    return { ok: true, data: { id } };
  } catch (err: any) {
    log.error('[IPC pos:hold] failed', err);
    return { ok: false, error: err?.message || 'HOLD_FAILED' };
  }
});

ipcMain.handle('pos:heldList', () => {
  const db = getDb();
  try {
    const rows = db.prepare('SELECT id,label,item_count,total,created_at FROM held_sales ORDER BY created_at DESC LIMIT 50').all();
    return { ok: true, data: rows };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'LIST_FAILED' };
  }
});

/**
 * Returns a held bill and removes it. Prices are re-read from the products
 * table rather than trusted from the stored payload, so a price changed since
 * the bill was parked is the one that gets charged. Items deleted meanwhile
 * are dropped and reported back to the caller.
 */
ipcMain.handle('pos:recall', (_e, id: string) => {
  const db = getDb();
  try {
    const row = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(id) as any;
    if (!row) return { ok: false, error: 'NOT_FOUND' };

    let stored: any[] = [];
    try { stored = JSON.parse(row.payload) || []; } catch { stored = []; }

    const cart: any[] = [];
    const dropped: string[] = [];
    for (const line of stored) {
      const pid = line?.product?.id;
      const p = pid ? db.prepare('SELECT * FROM products WHERE id = ?').get(pid) : null;
      if (!p) { dropped.push(line?.product?.name || 'Unknown item'); continue; }
      cart.push({ product: p, qty: Number(line.qty) || 1, unitPrice: Number((p as any).price) || 0 });
    }

    db.prepare('DELETE FROM held_sales WHERE id = ?').run(id);
    return { ok: true, data: { cart, dropped } };
  } catch (err: any) {
    log.error('[IPC pos:recall] failed', err);
    return { ok: false, error: err?.message || 'RECALL_FAILED' };
  }
});

ipcMain.handle('pos:discardHeld', (_e, id: string) => {
  const db = getDb();
  try {
    db.prepare('DELETE FROM held_sales WHERE id = ?').run(id);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'DISCARD_FAILED' };
  }
});

/* --------------------------------------------------------------------- voids */

/**
 * Reverses a sale: puts the stock back, records a 'return' movement per line,
 * and marks the sale voided. The sale row and its receipt number are kept so
 * the reversal shows up in an audit rather than silently vanishing.
 */
ipcMain.handle('pos:void', (_e, saleId: string, reason?: string, userId?: string) => {
  const db = getDb();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as any;
  if (!sale) return { ok: false, error: 'NOT_FOUND' };
  if (sale.voided_at) return { ok: false, error: 'ALREADY_VOIDED' };

  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as any[];
  if (!items.length) return { ok: false, error: 'NO_ITEMS' };

  const now = new Date().toISOString();
  try {
    db.exec('BEGIN');
    // Put each line back into the exact batch it was sold from, so expiry
    // dates stay truthful. Lines from before batch tracking have no batch and
    // are returned as a fresh one rather than vanishing.
    restoreAllocation(db, items.map((it: any) => ({ batch_id: it.batch_id, qty: it.quantity })));
    const touched = new Set<string>();
    for (const it of items) {
      if (!it.batch_id) {
        db.prepare(`INSERT INTO product_batches (id,product_id,batch_no,expiry,qty_received,qty_remaining,notes,created_by,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(randomUUID(), it.product_id, 'RETURN', null, it.quantity, it.quantity,
               'Returned from receipt #' + sale.receipt_no, userId || null, now);
      }
      db.prepare('INSERT INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(randomUUID(), it.product_id, 'return', it.quantity, saleId, reason || null, userId || null, now);
      touched.add(it.product_id);
    }
    for (const pid of touched) recomputeStock(db, pid);
    db.prepare('UPDATE sales SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?')
      .run(now, userId || null, reason || null, saleId);
    db.exec('COMMIT');
    for (const it of items) {
      recordEvent('stock.delta', { product_id: it.product_id, delta: it.quantity, reason: 'return',
        reference: saleId, batch_id: it.batch_id || null, ts: now });
    }
    log.info('[IPC pos:void] voided', { saleId, receiptNo: sale.receipt_no, lines: items.length });
    return { ok: true, data: { receipt_no: sale.receipt_no, restored: items.length } };
  } catch (err: any) {
    try { db.exec('ROLLBACK'); } catch {}
    log.error('[IPC pos:void] failed', err);
    return { ok: false, error: err?.message || 'VOID_FAILED' };
  }
});
