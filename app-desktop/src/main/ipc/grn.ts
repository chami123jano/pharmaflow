/**
 * Goods received notes.
 *
 * A GRN is one delivery: who it came from, their invoice, and every line on
 * it. Receiving one product at a time from Inventory still works; this is the
 * way to take in a whole carton of a supplier's invoice in one go.
 *
 * Every line becomes an ordinary batch through receiveBatch(), with grn_id
 * set on it. Nothing downstream — selling, FEFO, expiry, the website — needs
 * to know GRNs exist. Stock still travels to the other machine as one
 * stock.delta per batch; the GRN itself follows as a grn.created event so the
 * paperwork is there too.
 *
 * The whole note is saved in one transaction. A delivery half entered is worse
 * than none: the shelf and the paper would disagree and nobody would know
 * which lines made it.
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';
import log from '../log.js';
import { recordEvent, getDeviceId } from '../sync/events.js';
import { receiveBatch, recomputeStock, StockError } from '../db/batches.js';

interface LineIn {
  product_id: string;
  qty: number;
  free_qty?: number;
  cost_price?: number | null;
  batch_no?: string | null;
  expiry?: string | null;
}

interface GrnIn {
  supplier_id?: string | null;
  supplier_name?: string | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  invoice_total?: number | null;
  notes?: string | null;
  created_by?: string | null;
  /** Save even though this supplier's invoice number was used before. */
  allow_duplicate_invoice?: boolean;
  items: LineIn[];
}

const isDate = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const round2 = (n: number) => Math.round(n * 100) / 100;

function nextGrnNo(db: any, device: string): number {
  const row = db.prepare('SELECT COALESCE(MAX(grn_no), 0) AS n FROM grns WHERE device = ? OR device IS NULL').get(device) as any;
  return Number(row?.n || 0) + 1;
}

ipcMain.handle('grn:create', (_e, input: GrnIn) => {
  const db = getDb();
  try {
    const items = Array.isArray(input?.items) ? input.items : [];
    if (!items.length) return { ok: false, error: 'NO_ITEMS', message: 'Add at least one item' };

    // Check every line before anything is written, so the answer names the
    // problem line rather than failing half way through.
    for (const [i, it] of items.entries()) {
      const n = i + 1;
      const qty = Number(it.qty), free = Number(it.free_qty || 0);
      if (!it.product_id) return { ok: false, error: 'BAD_LINE', message: `Line ${n}: choose a product` };
      if (!Number.isInteger(qty) || qty < 0 || !Number.isInteger(free) || free < 0 || qty + free <= 0) {
        return { ok: false, error: 'BAD_LINE', message: `Line ${n}: quantity must be a whole number above zero` };
      }
      if (it.cost_price != null && (!Number.isFinite(Number(it.cost_price)) || Number(it.cost_price) < 0)) {
        return { ok: false, error: 'BAD_LINE', message: `Line ${n}: cost price cannot be negative` };
      }
      if (it.expiry && !isDate(it.expiry)) return { ok: false, error: 'BAD_LINE', message: `Line ${n}: expiry date is not valid` };
    }

    let supplierId = input.supplier_id || null;
    let supplierName = (input.supplier_name || '').trim() || null;
    if (supplierId) {
      const s = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId) as any;
      if (!s) return { ok: false, error: 'SUPPLIER_NOT_FOUND', message: 'That supplier no longer exists' };
      supplierName = s.name;
    }

    const invoiceNo = (input.invoice_no || '').trim() || null;
    if (invoiceNo && supplierName && !input.allow_duplicate_invoice) {
      const dup = db.prepare(`SELECT grn_no FROM grns WHERE voided_at IS NULL AND lower(invoice_no) = lower(?)
                              AND (supplier_id = ? OR lower(supplier_name) = lower(?))`)
        .get(invoiceNo, supplierId, supplierName) as any;
      if (dup) {
        return { ok: false, error: 'DUPLICATE_INVOICE',
          message: `Invoice ${invoiceNo} from ${supplierName} was already received on GRN-${String(dup.grn_no).padStart(4, '0')}` };
      }
    }

    let userName: string | null = null;
    if (input.created_by) {
      try { userName = (db.prepare('SELECT name, username FROM users WHERE id = ?').get(input.created_by) as any)?.name || null; } catch {}
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const device = getDeviceId();
    const lines: any[] = [];

    const grn = db.transaction(() => {
      const grnNo = nextGrnNo(db, device);
      let totalCost = 0, units = 0;

      db.prepare(`INSERT INTO grns (id,grn_no,supplier_id,supplier_name,invoice_no,invoice_date,invoice_total,total_cost,line_count,unit_count,notes,created_by,created_by_name,device,created_at)
                  VALUES (?,?,?,?,?,?,?,0,0,0,?,?,?,?,?)`)
        .run(id, grnNo, supplierId, supplierName, invoiceNo, isDate(input.invoice_date) ? input.invoice_date : null,
             input.invoice_total != null && Number.isFinite(Number(input.invoice_total)) ? Number(input.invoice_total) : null,
             (input.notes || '').trim() || null, input.created_by || null, userName, device, now);

      for (const it of items) {
        const qty = Number(it.qty), free = Number(it.free_qty || 0);
        const cost = it.cost_price != null && it.cost_price !== ('' as any) ? Number(it.cost_price) : null;
        // Free goods go on the shelf but are not paid for, so the unit cost
        // recorded on the batch is what was paid spread over everything that
        // arrived — the figure profit should be worked out against.
        const lineTotal = cost != null ? round2(cost * qty) : 0;
        const batchCost = cost != null && qty + free > 0 ? round2(lineTotal / (qty + free)) : null;

        const batch = receiveBatch(db, {
          product_id: it.product_id, qty: qty + free,
          expiry: it.expiry || null, batch_no: (it.batch_no || '').trim() || null,
          cost_price: batchCost, supplier: supplierName, created_by: input.created_by || null,
          notes: 'GRN-' + String(grnNo).padStart(4, '0'),
        });
        db.prepare('UPDATE product_batches SET grn_id = ?, supplier_id = ? WHERE id = ?').run(id, supplierId, batch.id);

        const p = db.prepare('SELECT name FROM products WHERE id = ?').get(it.product_id) as any;
        const itemId = randomUUID();
        db.prepare(`INSERT INTO grn_items (id,grn_id,product_id,product_name,batch_id,batch_no,expiry,qty,free_qty,cost_price,line_total)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(itemId, id, it.product_id, p?.name || null, batch.id, batch.batch_no, batch.expiry, qty, free, cost, lineTotal);

        const movementId = randomUUID();
        db.prepare('INSERT INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(movementId, it.product_id, 'restock', qty + free, batch.id,
               'GRN-' + String(grnNo).padStart(4, '0') + (supplierName ? ' from ' + supplierName : ''), input.created_by || null, now);

        lines.push({ id: itemId, product_id: it.product_id, product_name: p?.name || null, batch_id: batch.id,
                     batch_no: batch.batch_no, expiry: batch.expiry, qty, free_qty: free, cost_price: cost,
                     line_total: lineTotal, batch_cost: batchCost, movement_id: movementId });
        totalCost += lineTotal;
        units += qty + free;
      }

      db.prepare('UPDATE grns SET total_cost = ?, line_count = ?, unit_count = ? WHERE id = ?')
        .run(round2(totalCost), lines.length, units, id);
      return db.prepare('SELECT * FROM grns WHERE id = ?').get(id) as any;
    })();

    // Recorded only once the note is safely in. Stock first, as deltas like
    // every other stock change, then the paperwork that describes them.
    for (const l of lines) {
      recordEvent('stock.delta', {
        product_id: l.product_id, delta: l.qty + l.free_qty, reason: 'restock',
        movement_id: l.movement_id, batch_id: l.batch_id, expiry: l.expiry, batch_no: l.batch_no, ts: now,
      });
    }
    recordEvent('grn.created', {
      ...grn,
      items: lines.map(({ movement_id, ...l }) => l),
    });

    log.info('[IPC grn:create]', { grn: grn.grn_no, lines: lines.length, units: grn.unit_count });
    return { ok: true, data: { ...grn, items: lines } };
  } catch (err: any) {
    if (err instanceof StockError) return { ok: false, error: err.code, message: err.message };
    log.error('[IPC grn:create] failed', err);
    return { ok: false, error: 'CREATE_FAILED', message: err?.message || 'Could not save the GRN' };
  }
});

ipcMain.handle('grn:list', (_e, opts: { search?: string; limit?: number } = {}) => {
  const db = getDb();
  try {
    const q = String(opts?.search || '').trim().toLowerCase();
    const limit = Math.min(Number(opts?.limit) || 300, 2000);
    const rows = q
      ? db.prepare(`SELECT * FROM grns WHERE lower(COALESCE(supplier_name,'')) LIKE ? OR lower(COALESCE(invoice_no,'')) LIKE ?
                      OR CAST(grn_no AS TEXT) LIKE ? OR id IN (SELECT grn_id FROM grn_items WHERE lower(COALESCE(product_name,'')) LIKE ?)
                    ORDER BY created_at DESC LIMIT ?`)
          .all(`%${q}%`, `%${q}%`, `%${q.replace(/^grn-?0*/, '')}%`, `%${q}%`, limit)
      : db.prepare('SELECT * FROM grns ORDER BY created_at DESC LIMIT ?').all(limit);
    return { ok: true, data: rows };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'LIST_FAILED' };
  }
});

ipcMain.handle('grn:get', (_e, id: string) => {
  const db = getDb();
  try {
    const grn = db.prepare('SELECT * FROM grns WHERE id = ?').get(id) as any;
    if (!grn) return { ok: false, error: 'NOT_FOUND' };
    const items = db.prepare(`
      SELECT gi.*, COALESCE(p.name, gi.product_name) AS product_name, p.sku AS sku,
             b.qty_remaining AS qty_remaining, b.qty_received AS qty_received
      FROM grn_items gi
      LEFT JOIN products p ON p.id = gi.product_id
      LEFT JOIN product_batches b ON b.id = gi.batch_id
      WHERE gi.grn_id = ? ORDER BY gi.rowid
    `).all(id) as any[];
    // Voidable only while every unit is still on the shelf: once some has been
    // sold, taking the delivery back out would push stock below what was sold.
    const untouched = items.every((i) => i.batch_id && Number(i.qty_remaining) === Number(i.qty_received));
    return { ok: true, data: { ...grn, items, can_void: !grn.voided_at && untouched } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'GET_FAILED' };
  }
});

/**
 * Cancels a GRN entered by mistake, taking its stock back off the shelf.
 * Admin only, read from the database rather than trusted from the screen.
 */
ipcMain.handle('grn:void', (_e, id: string, userId: string, reason?: string) => {
  const db = getDb();
  try {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
    if (String(u?.role || '').toLowerCase() !== 'admin') return { ok: false, error: 'FORBIDDEN', message: 'Only an admin can cancel a GRN' };

    const grn = db.prepare('SELECT * FROM grns WHERE id = ?').get(id) as any;
    if (!grn) return { ok: false, error: 'NOT_FOUND' };
    if (grn.voided_at) return { ok: false, error: 'ALREADY_VOID', message: 'This GRN is already cancelled' };

    const batches = db.prepare(`SELECT b.* FROM grn_items gi JOIN product_batches b ON b.id = gi.batch_id WHERE gi.grn_id = ?`).all(id) as any[];
    const count = (db.prepare('SELECT COUNT(1) AS c FROM grn_items WHERE grn_id = ?').get(id) as any)?.c || 0;
    if (batches.length !== Number(count) || batches.some((b) => Number(b.qty_remaining) !== Number(b.qty_received))) {
      return { ok: false, error: 'IN_USE', message: 'Some of this delivery has already been sold or adjusted, so it cannot be cancelled' };
    }

    const now = new Date().toISOString();
    const moves: any[] = [];
    db.transaction(() => {
      for (const b of batches) {
        db.prepare('UPDATE product_batches SET qty_remaining = 0 WHERE id = ?').run(b.id);
        recomputeStock(db, b.product_id);
        const movementId = randomUUID();
        db.prepare('INSERT INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(movementId, b.product_id, 'adjust', -Number(b.qty_received), b.id,
               'GRN-' + String(grn.grn_no).padStart(4, '0') + ' cancelled', userId, now);
        moves.push({ product_id: b.product_id, delta: -Number(b.qty_received), batch_id: b.id, movement_id: movementId });
      }
      db.prepare('UPDATE grns SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?')
        .run(now, userId, (reason || '').trim() || null, id);
    })();

    for (const m of moves) recordEvent('stock.delta', { ...m, reason: 'adjust', ts: now });
    recordEvent('grn.voided', { id, voided_at: now, voided_by: userId, void_reason: (reason || '').trim() || null });
    return { ok: true };
  } catch (err: any) {
    log.error('[IPC grn:void] failed', err);
    return { ok: false, error: 'VOID_FAILED', message: err?.message || 'Could not cancel the GRN' };
  }
});
