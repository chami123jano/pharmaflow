/**
 * Batch handling: which physical delivery a sold unit comes out of.
 *
 * The rule is FEFO — first expired, first out. Stock that expires soonest
 * leaves the shop first, so medicine does not quietly go out of date on the
 * shelf. Note this is expiry order, not delivery order: a box bought today
 * with a short date sells before one bought last year with a long one.
 *
 * products.stock stays as the sum of a product's remaining batch quantities.
 * It is a cache, recomputed after every change, so the POS, reports and stock
 * badges keep working without each of them learning about batches.
 */
import { randomUUID } from 'crypto';

export interface Batch {
  id: string;
  product_id: string;
  batch_no: string | null;
  expiry: string | null;
  qty_received: number;
  qty_remaining: number;
  cost_price: number | null;
  supplier: string | null;
}

export interface Allocation {
  batch_id: string;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
}

/** Today as YYYY-MM-DD, matching how expiry dates are stored. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isExpired(expiry: string | null | undefined, on = today()): boolean {
  if (!expiry) return false; // no date recorded means we cannot call it expired
  return String(expiry).slice(0, 10) < on;
}

/** Recomputes and stores a product's total stock from its batches. */
export function recomputeStock(db: any, productId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(qty_remaining),0) AS n FROM product_batches WHERE product_id = ?').get(productId) as any;
  const total = Number(row?.n || 0);
  db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(total, new Date().toISOString(), productId);
  return total;
}

/**
 * Batches with stock left, soonest expiry first. Rows without an expiry date
 * sort last: something with a known short date should always go before stock
 * whose date nobody recorded.
 */
export function batchesFor(db: any, productId: string): Batch[] {
  return db.prepare(`
    SELECT * FROM product_batches
    WHERE product_id = ? AND qty_remaining > 0
    ORDER BY CASE WHEN expiry IS NULL OR expiry = '' THEN 1 ELSE 0 END, expiry ASC, created_at ASC
  `).all(productId) as Batch[];
}

export interface AllocateOptions {
  /** Admins may sell expired stock deliberately; cashiers may not. */
  allowExpired?: boolean;
}

export class StockError extends Error {
  code: string;
  detail: any;
  constructor(code: string, message: string, detail?: any) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Picks which batches cover a quantity, without writing anything.
 *
 * Throws rather than partially filling: a sale that cannot be covered should
 * fail before any stock moves.
 */
export function planAllocation(db: any, productId: string, qty: number, opts: AllocateOptions = {}): Allocation[] {
  const want = Number(qty);
  if (!Number.isInteger(want) || want <= 0) throw new StockError('INVALID_QUANTITY', 'Quantity must be a whole number above zero');

  const all = batchesFor(db, productId);
  const usable = opts.allowExpired ? all : all.filter((b) => !isExpired(b.expiry));

  const available = usable.reduce((s, b) => s + Number(b.qty_remaining || 0), 0);
  if (available < want) {
    const blocked = all.reduce((s, b) => s + Number(b.qty_remaining || 0), 0) - available;
    if (blocked > 0 && !opts.allowExpired) {
      throw new StockError('EXPIRED_STOCK',
        `Only ${available} usable — ${blocked} more is expired and cannot be sold`,
        { available, expired: blocked });
    }
    throw new StockError('INSUFFICIENT_STOCK', `Only ${available} in stock`, { available });
  }

  const out: Allocation[] = [];
  let left = want;
  for (const b of usable) {
    if (left <= 0) break;
    const take = Math.min(left, Number(b.qty_remaining || 0));
    if (take <= 0) continue;
    out.push({ batch_id: b.id, batch_no: b.batch_no, expiry: b.expiry, qty: take });
    left -= take;
  }
  return out;
}

/** Applies a plan, reducing each batch. Caller owns the transaction. */
export function applyAllocation(db: any, allocations: Allocation[]): void {
  for (const a of allocations) {
    const res = db.prepare('UPDATE product_batches SET qty_remaining = qty_remaining - ? WHERE id = ? AND qty_remaining >= ?')
      .run(a.qty, a.batch_id, a.qty);
    // sql.js reports changes; if the row moved under us, stop rather than
    // letting a batch go negative.
    if (res && typeof res.changes === 'number' && res.changes === 0) {
      throw new StockError('BATCH_CHANGED', 'Stock changed while the sale was being saved — try again');
    }
  }
}

/** Puts quantities back, for a void or a return. */
export function restoreAllocation(db: any, allocations: Array<{ batch_id: string | null; qty: number; product_id?: string }>): void {
  for (const a of allocations) {
    if (!a.batch_id) continue;
    db.prepare('UPDATE product_batches SET qty_remaining = qty_remaining + ? WHERE id = ?').run(a.qty, a.batch_id);
  }
}

export interface ReceiveInput {
  product_id: string;
  qty: number;
  expiry?: string | null;
  batch_no?: string | null;
  cost_price?: number | null;
  supplier?: string | null;
  notes?: string | null;
  created_by?: string | null;
}

/** Records a delivery as a new batch and returns it. */
export function receiveBatch(db: any, input: ReceiveInput): Batch {
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty <= 0) throw new StockError('INVALID_QUANTITY', 'Quantity must be a whole number above zero');

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(input.product_id);
  if (!product) throw new StockError('NOT_FOUND', 'Product not found');

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO product_batches (id,product_id,batch_no,expiry,qty_received,qty_remaining,cost_price,supplier,notes,created_by,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, input.product_id, input.batch_no || null, input.expiry || null, qty, qty,
         input.cost_price ?? null, input.supplier || null, input.notes || null, input.created_by || null, now);

  recomputeStock(db, input.product_id);
  return db.prepare('SELECT * FROM product_batches WHERE id = ?').get(id) as Batch;
}
