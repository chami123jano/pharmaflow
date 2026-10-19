/**
 * Keeping each product's cost price current.
 *
 * A delivery is the best evidence of what an item costs, so receiving one
 * updates the product's cost to what was just paid. The change travels to the
 * other machine as an ordinary product.upsert, like any other edit.
 */
import { recordEvent } from '../sync/events.js';

/** Parses a cost typed by a person: blank means "not known", never zero. */
export function parseCost(v: any): number | null | 'INVALID' {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 'INVALID';
  return Math.round(n * 100) / 100;
}

/** Call after the write that received the stock has committed. */
export function noteLatestCost(db: any, productId: string, cost: number | null | undefined): void {
  if (cost == null || !Number.isFinite(Number(cost)) || Number(cost) < 0) return;
  try {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
    if (!p || (p.cost_price != null && Number(p.cost_price) === Number(cost))) return;
    const now = new Date().toISOString();
    db.prepare('UPDATE products SET cost_price = ?, updated_at = ? WHERE id = ?').run(Number(cost), now, productId);
    recordEvent('product.upsert', {
      id: p.id, name: p.name, sku: p.sku, price: p.price, cost_price: Number(cost), expiry: p.expiry || null,
      description: p.description || null, supplier: p.supplier || null, category: p.category || null,
      generic_name: p.generic_name || null, barcode: p.barcode || null, updated_at: now,
    });
  } catch {}
}
