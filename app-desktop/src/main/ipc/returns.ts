/**
 * Returns: part of a bill coming back.
 *
 * Until now the only way to give money back was to void the whole bill. A
 * customer returning one of three items needed the bill cancelled and the
 * other two rung up again. Now any number of units from any lines can come
 * back, as many times as needed, until the bill is fully returned.
 *
 * The refund is what the customer actually paid for those units: the line
 * price less the bill's discount spread evenly, so a 10% discount on the bill
 * means 10% less back. The sale itself is never edited; `sales.refunded`
 * keeps a running total, and takings everywhere are total − refunded.
 *
 * Units can go back on the shelf (into the batch they came from, so the expiry
 * stays true) or not — returned medicine often cannot be resold. That choice
 * is what the profit report needs: back on the shelf, the cost comes back too;
 * thrown away, the shop has lost the cost as well as the sale.
 *
 * Cashiers need an admin to approve, like a large discount. The approver's
 * role is read from the database here, never trusted from the screen.
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';
import log from '../log.js';
import { recordEvent, getDeviceId } from '../sync/events.js';
import { receiveBatch, recomputeStock } from '../db/batches.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

interface ReturnIn {
  sale_id: string;
  items: Array<{ sale_item_id: string; qty: number; restock?: boolean }>;
  method?: 'cash' | 'card';
  reason?: string;
  user_id?: string;
  approver_id?: string;
}

function roleOf(db: any, id?: string) {
  if (!id) return null;
  return (db.prepare('SELECT role, name, username FROM users WHERE id = ?').get(id) as any) || null;
}

/** A bill as the return screen needs it: each line with what can still come back. */
function billForReturn(db: any, sale: any) {
  const ratio = Number(sale.subtotal) > 0 ? Number(sale.total) / Number(sale.subtotal) : 1;
  const lines = db.prepare(`
    SELECT si.id, si.product_id, si.quantity, si.unit_price, si.line_total, si.batch_id, si.unit_cost,
           COALESCE(p.name, 'Item') AS name,
           COALESCE((SELECT SUM(ri.qty) FROM sale_return_items ri WHERE ri.sale_item_id = si.id), 0) AS returned
    FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ? ORDER BY si.rowid
  `).all(sale.id) as any[];
  return lines.map((l) => ({
    ...l,
    returnable: Number(l.quantity) - Number(l.returned),
    // What one unit actually cost the customer after the bill's discount.
    refund_each: r2(Number(l.unit_price) * ratio),
  }));
}

ipcMain.handle('returns:lookup', (_e, receiptNo: number | string) => {
  const db = getDb();
  try {
    const n = Number(String(receiptNo).replace(/\D/g, ''));
    if (!n) return { ok: false, error: 'NO_RECEIPT', message: 'Type the bill number from the receipt' };
    const sale = db.prepare('SELECT s.*, u.name AS cashier_name FROM sales s LEFT JOIN users u ON u.id = s.cashier_id WHERE s.receipt_no = ? ORDER BY s.created_at DESC').get(n) as any;
    if (!sale) return { ok: false, error: 'NOT_FOUND', message: `No bill #${n} on this computer` };
    if (sale.voided_at) return { ok: false, error: 'VOIDED', message: `Bill #${n} was cancelled — nothing to return` };
    const lines = billForReturn(db, sale);
    const returns = db.prepare('SELECT * FROM sale_returns WHERE sale_id = ? ORDER BY created_at').all(sale.id);
    return { ok: true, data: { sale, lines, returns } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'LOOKUP_FAILED' };
  }
});

ipcMain.handle('returns:create', (_e, input: ReturnIn) => {
  const db = getDb();
  try {
    const user = roleOf(db, input.user_id);
    const approver = roleOf(db, input.approver_id);
    const isAdmin = (u: any) => String(u?.role || '').toLowerCase() === 'admin';
    if (!isAdmin(user) && !isAdmin(approver)) {
      return { ok: false, error: 'NEEDS_ADMIN', message: 'An admin has to approve a return' };
    }

    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(input.sale_id) as any;
    if (!sale) return { ok: false, error: 'NOT_FOUND', message: 'Bill not found' };
    if (sale.voided_at) return { ok: false, error: 'VOIDED', message: 'This bill was cancelled' };

    const lines = new Map(billForReturn(db, sale).map((l: any) => [l.id, l]));
    const wanted = (input.items || []).filter((i) => Number(i.qty) > 0);
    if (!wanted.length) return { ok: false, error: 'NO_ITEMS', message: 'Choose at least one item to return' };
    for (const w of wanted) {
      const l: any = lines.get(w.sale_item_id);
      if (!l) return { ok: false, error: 'BAD_LINE', message: 'That item is not on this bill' };
      if (!Number.isInteger(Number(w.qty))) return { ok: false, error: 'BAD_QTY', message: 'Whole numbers only' };
      if (Number(w.qty) > l.returnable) {
        return { ok: false, error: 'TOO_MANY', message: `Only ${l.returnable} of ${l.name} can still come back` };
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const device = getDeviceId();
    const method = input.method === 'card' ? 'card' : 'cash';
    const out: any[] = [];

    const ret = db.transaction(() => {
      const no = Number((db.prepare('SELECT COALESCE(MAX(return_no),0) AS n FROM sale_returns WHERE device = ? OR device IS NULL').get(device) as any)?.n || 0) + 1;
      let total = 0;
      for (const w of wanted) {
        const l: any = lines.get(w.sale_item_id);
        const qty = Number(w.qty);
        const restock = w.restock !== false;
        let refund = r2(l.refund_each * qty);
        // Never pay back more than is left on the bill — rounding on many
        // small lines must not add up to more than the customer paid.
        const left = r2(Number(sale.total) - Number(sale.refunded || 0) - total);
        if (refund > left) refund = Math.max(0, left);
        total = r2(total + refund);

        let batchId: string | null = l.batch_id || null;
        if (restock) {
          const has = batchId ? db.prepare('SELECT id FROM product_batches WHERE id = ?').get(batchId) : null;
          if (has) {
            db.prepare('UPDATE product_batches SET qty_remaining = qty_remaining + ? WHERE id = ?').run(qty, batchId);
            recomputeStock(db, l.product_id);
          } else {
            const b = receiveBatch(db, { product_id: l.product_id, qty, cost_price: l.unit_cost ?? null, notes: 'Returned from bill #' + sale.receipt_no });
            batchId = b.id;
          }
        }
        const movementId = randomUUID();
        db.prepare('INSERT INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(movementId, l.product_id, restock ? 'return' : 'return-discarded', restock ? qty : 0, sale.id,
               `Return #${no} from bill #${sale.receipt_no}${restock ? '' : ' (not put back)'}`, input.user_id || null, now);
        const itemId = randomUUID();
        db.prepare(`INSERT INTO sale_return_items (id,return_id,sale_item_id,product_id,product_name,batch_id,qty,unit_price,refund,unit_cost,restocked)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(itemId, id, l.id, l.product_id, l.name, batchId, qty, l.unit_price, refund, l.unit_cost ?? null, restock ? 1 : 0);
        out.push({ id: itemId, sale_item_id: l.id, product_id: l.product_id, product_name: l.name, batch_id: batchId,
                   qty, unit_price: l.unit_price, refund, unit_cost: l.unit_cost ?? null, restocked: restock ? 1 : 0, movement_id: movementId });
      }
      db.prepare(`INSERT INTO sale_returns (id,return_no,sale_id,receipt_no,refund_total,method,reason,created_by,created_by_name,approved_by,device,created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, no, sale.id, sale.receipt_no, total, method, (input.reason || '').trim() || null, input.user_id || null,
             user?.name || user?.username || null, approver?.name || approver?.username || null, device, now);
      db.prepare('UPDATE sales SET refunded = ROUND(COALESCE(refunded,0) + ?, 2) WHERE id = ?').run(total, sale.id);
      return db.prepare('SELECT * FROM sale_returns WHERE id = ?').get(id) as any;
    })();

    for (const l of out) {
      if (l.restocked) {
        recordEvent('stock.delta', { product_id: l.product_id, delta: l.qty, reason: 'return', reference: sale.id,
          movement_id: l.movement_id, batch_id: l.batch_id, cost_price: l.unit_cost, ts: now });
      }
    }
    recordEvent('sale.returned', { ...ret, items: out.map(({ movement_id, ...x }) => x) });
    log.info('[IPC returns:create]', { bill: sale.receipt_no, return: ret.return_no, refund: ret.refund_total });
    return { ok: true, data: { ...ret, items: out, sale } };
  } catch (err: any) {
    log.error('[IPC returns:create] failed', err);
    return { ok: false, error: 'RETURN_FAILED', message: err?.message || 'Could not record the return' };
  }
});

ipcMain.handle('returns:list', (_e, opts: { limit?: number } = {}) => {
  const db = getDb();
  try {
    const rows = db.prepare('SELECT * FROM sale_returns ORDER BY created_at DESC LIMIT ?').all(Math.min(Number(opts?.limit) || 200, 2000));
    return { ok: true, data: rows };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'LIST_FAILED' };
  }
});
