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

/**
 * The shop's own identity, so the website can read it instead of being told at
 * build time. One row, always id 1.
 */
function shopRow(db: any) {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'pharmacy.%' OR key = 'categories.custom'").all() as any[];
  const m: Record<string, string> = Object.fromEntries(rows.map((r) => [r.key, String(r.value ?? '')]));
  const pick = (k: string) => (m['pharmacy.' + k] || '').trim() || null;
  return {
    id: 1,
    name: pick('name'),
    address: pick('address'),
    phone: pick('phone'),
    regno: pick('regno'),
    footer: pick('footer'),
    logo: pick('logo'),
    categories: (() => { try { return JSON.parse(m['categories.custom'] || '[]'); } catch { return []; } })(),
    updated_at: new Date().toISOString(),
  };
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
    // A return changes an older bill's `refunded`, so those bills go again too.
    where = `WHERE s.created_at > ? OR (s.voided_at IS NOT NULL AND s.voided_at > ?)
             OR s.id IN (SELECT sale_id FROM sale_returns WHERE created_at > ?)`;
    params.push(salesSince, salesSince, salesSince);
  }

  const sales = db.prepare(`
    SELECT s.id, s.receipt_no, s.subtotal, s.discount_amount, s.total, s.refunded, s.payment_method,
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
      SELECT si.id, si.sale_id, si.product_id, si.quantity, si.unit_price, si.line_total, si.batch_id, si.unit_cost,
             p.name AS product_name
      FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
      WHERE si.sale_id IN (${holes})
    `).all(...ids) as any[];
  }

  const newestSale = sales.length ? sales[sales.length - 1].created_at : null;

  // The owner's extras: deliveries, returns and cash-ups. Small tables, sent
  // whole (the last few thousand rows), so nothing depends on a watermark.
  const grns = db.prepare('SELECT * FROM grns ORDER BY created_at DESC LIMIT 2000').all() as any[];
  const grnIds = grns.map((g) => g.id);
  const grnItems = grnIds.length
    ? db.prepare(`SELECT * FROM grn_items WHERE grn_id IN (${grnIds.map(() => '?').join(',')})`).all(...grnIds) as any[]
    : [];
  const returns = db.prepare('SELECT * FROM sale_returns ORDER BY created_at DESC LIMIT 5000').all() as any[];
  const retIds = returns.map((r) => r.id);
  const returnItems = retIds.length
    ? db.prepare(`SELECT * FROM sale_return_items WHERE return_id IN (${retIds.map(() => '?').join(',')})`).all(...retIds) as any[]
    : [];
  const cashUps = db.prepare('SELECT * FROM cash_ups ORDER BY created_at DESC LIMIT 2000').all() as any[];
  const bills = db.prepare('SELECT * FROM supplier_bills ORDER BY created_at DESC LIMIT 5000').all() as any[];
  const billPayments = db.prepare('SELECT * FROM supplier_payments ORDER BY created_at DESC LIMIT 20000').all() as any[];
  const num = (v: any) => (v == null ? null : Number(v));

  return {
    newestSale,
    shop: shopRow(db),
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
      total: Number(s.total || 0), refunded: Number(s.refunded || 0), payment_method: s.payment_method,
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
      unit_cost: num(i.unit_cost),
    })),
    extras: {
      grns: grns.map((g) => ({
        id: g.id, grn_no: g.grn_no, supplier_name: g.supplier_name, invoice_no: g.invoice_no,
        invoice_date: orNull(g.invoice_date), invoice_total: num(g.invoice_total), total_cost: Number(g.total_cost || 0),
        line_count: Number(g.line_count || 0), unit_count: Number(g.unit_count || 0), notes: g.notes,
        created_by_name: g.created_by_name, device_id: g.device || deviceId,
        voided_at: orNull(g.voided_at), void_reason: g.void_reason, created_at: g.created_at,
      })),
      grnItems: grnItems.map((i) => ({
        id: i.id, grn_id: i.grn_id, product_id: i.product_id, product_name: i.product_name, batch_no: i.batch_no,
        expiry: orNull(i.expiry), qty: Number(i.qty || 0), free_qty: Number(i.free_qty || 0),
        cost_price: num(i.cost_price), line_total: Number(i.line_total || 0),
      })),
      returns: returns.map((r) => ({
        id: r.id, return_no: r.return_no, sale_id: r.sale_id, receipt_no: r.receipt_no, refund_total: Number(r.refund_total || 0),
        method: r.method, reason: r.reason, created_by_name: r.created_by_name, approved_by: r.approved_by,
        device_id: r.device || deviceId, created_at: r.created_at,
      })),
      returnItems: returnItems.map((i) => ({
        id: i.id, return_id: i.return_id, sale_item_id: i.sale_item_id, product_id: i.product_id, product_name: i.product_name,
        qty: Number(i.qty || 0), unit_price: num(i.unit_price), refund: Number(i.refund || 0),
        unit_cost: num(i.unit_cost), restocked: !!i.restocked,
      })),
      bills: bills.map((b) => ({
        id: b.id, bill_no: b.bill_no, supplier_name: b.supplier_name, grn_id: b.grn_id || null, invoice_no: b.invoice_no,
        invoice_date: orNull(b.invoice_date), amount: Number(b.amount || 0), paid: Number(b.paid || 0),
        credit_days: b.credit_days == null ? null : Number(b.credit_days), due_date: orNull(b.due_date), notes: b.notes,
        created_by_name: b.created_by_name, device_id: b.device || deviceId, created_at: b.created_at,
        voided_at: orNull(b.voided_at), void_reason: b.void_reason,
      })),
      billPayments: billPayments.map((x) => ({
        id: x.id, bill_id: x.bill_id, amount: Number(x.amount || 0), method: x.method, cheque_no: x.cheque_no,
        cheque_date: orNull(x.cheque_date), reference: x.reference, paid_on: orNull(x.paid_on), notes: x.notes,
        created_by_name: x.created_by_name, created_at: x.created_at, voided_at: orNull(x.voided_at),
      })),
      cashUps: cashUps.map((c) => ({
        id: c.id, period_start: c.period_start, period_end: c.period_end, float_amount: Number(c.float_amount || 0),
        cash_sales: Number(c.cash_sales || 0), card_sales: Number(c.card_sales || 0), cash_refunds: Number(c.cash_refunds || 0),
        card_refunds: Number(c.card_refunds || 0), sales_count: Number(c.sales_count || 0), expected_cash: Number(c.expected_cash || 0),
        counted_cash: Number(c.counted_cash || 0), difference: Number(c.difference || 0), notes: c.notes,
        created_by_name: c.created_by_name, device_id: c.device || deviceId, created_at: c.created_at,
      })),
    },
  };
}
