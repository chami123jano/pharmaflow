/**
 * Turns local rows into the shape the cloud mirror expects.
 *
 * The website reads these tables directly, so they carry resolved names —
 * cashier and product — rather than ids it would have to look up. The desktop
 * is the only writer, so denormalising here costs nothing and saves the phone
 * a join on every report.
 */
import type { Snapshot } from './supabase.js';

/** Reference data is small enough to send whole every time. */
function referenceRows(db: any) {
  const products = db.prepare(`
    SELECT id, name, sku, generic_name, barcode, category, price, stock,
           supplier, description, expiry, created_at, updated_at
    FROM products
  `).all() as any[];

  const batches = db.prepare(`
    SELECT id, product_id, batch_no, expiry, qty_received, qty_remaining,
           cost_price, supplier, supplier_id, created_at
    FROM product_batches
  `).all() as any[];

  const customers = db.prepare('SELECT id, name, phone, email, address, notes, created_at, updated_at FROM customers').all() as any[];
  const suppliers = db.prepare('SELECT id, name, phone, email, address, contact_person, notes, created_at, updated_at FROM suppliers').all() as any[];

  return { products, batches, customers, suppliers };
}

/** Blank dates upset Postgres, which wants null or a real date. */
const orNull = (v: any) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/**
 * Sales are sent from a watermark rather than wholesale — a year of trading
 * should not be re-uploaded every time the app syncs. Voids are picked up by
 * also re-sending anything voided since the watermark.
 */
export function buildSnapshot(db: any, deviceId: string, salesSince: string | null): Snapshot & { newestSale: string | null } {
  const { products, batches, customers, suppliers } = referenceRows(db);

  const params: any[] = [];
  let where = '';
  if (salesSince) {
    where = 'WHERE s.created_at > ? OR (s.voided_at IS NOT NULL AND s.voided_at > ?)';
    params.push(salesSince, salesSince);
  }

  const sales = db.prepare(`
    SELECT s.id, s.receipt_no, s.subtotal, s.discount_amount, s.total, s.payment_method,
           s.customer_amount, s.change_amount, s.customer_id, s.voided_at, s.created_at,
           u.name AS cashier_name, u.email AS cashier_email
    FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
    ${where}
    ORDER BY s.created_at ASC
    LIMIT 2000
  `).all(...params) as any[];

  let saleItems: any[] = [];
  if (sales.length) {
    const ids = sales.map((s) => s.id);
    const holes = ids.map(() => '?').join(',');
    saleItems = db.prepare(`
      SELECT si.id, si.sale_id, si.product_id, si.quantity, si.unit_price, si.line_total, si.batch_id,
             p.name AS product_name
      FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
      WHERE si.sale_id IN (${holes})
    `).all(...ids) as any[];
  }

  const newestSale = sales.length ? sales[sales.length - 1].created_at : null;

  return {
    newestSale,
    products: products.map((p) => ({
      id: p.id, name: p.name, sku: p.sku, generic_name: p.generic_name, barcode: p.barcode,
      category: p.category, price: Number(p.price || 0), stock: Number(p.stock || 0),
      supplier: p.supplier, description: p.description, expiry: orNull(p.expiry),
      created_at: p.created_at, updated_at: p.updated_at,
    })),
    batches: batches.map((b) => ({
      id: b.id, product_id: b.product_id, batch_no: b.batch_no, expiry: orNull(b.expiry),
      qty_received: Number(b.qty_received || 0), qty_remaining: Number(b.qty_remaining || 0),
      cost_price: b.cost_price == null ? null : Number(b.cost_price),
      supplier: b.supplier, supplier_id: b.supplier_id || null, created_at: b.created_at,
    })),
    customers: customers.map((c) => ({
      id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address,
      notes: c.notes, created_at: c.created_at, updated_at: c.updated_at,
    })),
    suppliers: suppliers.map((s) => ({
      id: s.id, name: s.name, phone: s.phone, email: s.email, address: s.address,
      contact_person: s.contact_person, notes: s.notes, created_at: s.created_at, updated_at: s.updated_at,
    })),
    sales: sales.map((s) => ({
      id: s.id, receipt_no: s.receipt_no,
      subtotal: Number(s.subtotal || 0), discount_amount: Number(s.discount_amount || 0),
      total: Number(s.total || 0), payment_method: s.payment_method,
      customer_amount: Number(s.customer_amount || 0), change_amount: Number(s.change_amount || 0),
      cashier_name: s.cashier_name || s.cashier_email || null,
      customer_id: s.customer_id || null,
      device_id: deviceId,
      voided_at: orNull(s.voided_at), created_at: s.created_at,
    })),
    saleItems: saleItems.map((i) => ({
      id: i.id, sale_id: i.sale_id, product_id: i.product_id, product_name: i.product_name,
      quantity: Number(i.quantity || 0), unit_price: Number(i.unit_price || 0),
      line_total: Number(i.line_total || 0), batch_id: i.batch_id || null,
    })),
  };
}
