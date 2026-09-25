import { ipcMain } from 'electron';
import { getDb } from '../db/index.js';
import { randomUUID } from 'crypto';
import log from '../log.js';
import { recordEvent } from '../sync/events.js';
import { planAllocation, applyAllocation, recomputeStock, StockError } from '../db/batches.js';

ipcMain.handle('sales:list', (_e, limit = 200) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.*, u.name as cashier_name, u.email as cashier_email
    FROM sales s
    LEFT JOIN users u ON u.id = s.cashier_id
    ORDER BY s.created_at DESC LIMIT ?
  `).all(limit);
  return { ok: true, data: rows };
});

ipcMain.handle('sales:get', (_e, id: string) => {
  const db = getDb();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!sale) return { ok: false, error: 'NOT_FOUND' };
  const items = db.prepare(`
    SELECT si.*, p.name as product_name, p.sku as product_sku
    FROM sale_items si JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ?
  `).all(id);
  return { ok: true, data: { ...sale, items } };
});

ipcMain.handle('sales:create', (_e, payload: {
  items: Array<{ product_id: string; quantity: number }>;
  payment_method: string;
  discount_type?: 'percent' | 'fixed';
  discount_value?: number;
  customer_amount?: number;
  cashier_id?: string;
  customer_id?: string;
  notes?: string;
}) => {
  const { items, payment_method, discount_type = 'percent', discount_value = 0,
          customer_amount = 0, cashier_id, customer_id, notes } = payload || ({} as any);

  if (!items || !Array.isArray(items) || items.length === 0) return { ok: false, error: 'NO_ITEMS' };
  for (const it of items) {
    const q = Number(it?.quantity);
    if (!it?.product_id || !Number.isInteger(q) || q <= 0) return { ok: false, error: 'INVALID_ITEM' };
  }

  const db = getDb();

  // Read max discount from settings (default 100%)
  let maxDiscount = 100;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'sale.max_discount'").get() as any;
    if (row?.value) maxDiscount = Math.max(0, Math.min(100, Number(row.value) || 100));
  } catch {}

  // Validate discount
  const dType = (discount_type === 'fixed' || discount_type === 'percent') ? discount_type : 'percent';
  let dValue = Math.max(0, Number(discount_value) || 0);
  if (dType === 'percent' && dValue > maxDiscount) return { ok: false, error: `DISCOUNT_MAX_${maxDiscount}` };

  // Only an admin may knowingly sell expired stock. The role is read from the
  // database rather than taken from the renderer, which could claim anything.
  let allowExpired = false;
  try {
    if (cashier_id) {
      const u = db.prepare('SELECT role FROM users WHERE id = ?').get(cashier_id) as any;
      allowExpired = String(u?.role || '').toLowerCase() === 'admin';
    }
  } catch {}

  const now = new Date().toISOString();
  const saleId = randomUUID();
  let receiptNo = 0;
  let subtotal = 0;

  // Use direct BEGIN/COMMIT to avoid wrapper issues with sql.js persist()
  let result: any;
  const soldLines: any[] = [];
  try {
    db.exec('BEGIN');

    // Generate receipt number
    db.prepare('INSERT INTO receipt_seq (ts) VALUES (?)').run(now);
    const seqRow = db.prepare('SELECT last_insert_rowid() as id').get() as any;
    receiptNo = Number(seqRow?.id || 0);

    // Insert sale skeleton
    db.prepare(`INSERT INTO sales (id,receipt_no,subtotal,discount_type,discount_value,discount_amount,total,payment_method,customer_amount,change_amount,cashier_id,customer_id,notes,created_at) VALUES (?,?,0,?,?,0,0,?,?,0,?,?,?,?)`)
      .run(saleId, receiptNo, dType, dValue, (payment_method || 'cash').toLowerCase(), Number(customer_amount) || 0, cashier_id || null, customer_id || null, notes || null, now);

    // Process items. Each is drawn from batches in expiry order, so a line can
    // become more than one sale_item when it spans two deliveries. Price does
    // not vary by batch, so the money is unaffected by how it splits.
    for (const it of items) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id) as any;
      if (!p) throw new Error('PRODUCT_NOT_FOUND:' + it.product_id);
      if (!Number.isFinite(p.price) || p.price <= 0) throw new Error('INVALID_PRICE');

      let plan;
      try {
        plan = planAllocation(db, p.id, Number(it.quantity), { allowExpired });
      } catch (err: any) {
        if (err instanceof StockError) throw new Error(err.code + ':' + p.name + ':' + err.message);
        throw err;
      }
      applyAllocation(db, plan);

      for (const a of plan) {
        const lineTotal = Number(p.price) * a.qty;
        subtotal += lineTotal;
        const lineId = randomUUID();
        db.prepare('INSERT INTO sale_items (id,sale_id,product_id,quantity,unit_price,line_total,batch_id) VALUES (?,?,?,?,?,?,?)')
          .run(lineId, saleId, p.id, a.qty, p.price, lineTotal, a.batch_id);
        const movementId = randomUUID();
        try {
          db.prepare('INSERT INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
            .run(movementId, p.id, 'sale', -a.qty, saleId, a.batch_no ? 'batch ' + a.batch_no : null, cashier_id || null, now);
        } catch {}
        soldLines.push({ id: lineId, product_id: p.id, quantity: a.qty, unit_price: p.price, line_total: lineTotal, movement_id: movementId, batch_id: a.batch_id });
      }

      recomputeStock(db, p.id);
    }

    // Calculate totals
    let discountAmount = dType === 'percent' ? subtotal * (dValue / 100) : Math.min(dValue, subtotal);
    discountAmount = Math.max(0, Math.round(discountAmount * 100) / 100);
    const total = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
    const custAmt = Number(customer_amount) || 0;
    const changeAmt = Math.max(0, Math.round((custAmt - total) * 100) / 100);

    db.prepare('UPDATE sales SET subtotal=?,discount_amount=?,total=?,customer_amount=?,change_amount=? WHERE id=?').run(subtotal, discountAmount, total, custAmt, changeAmt, saleId);

    db.exec('COMMIT');
    // Recorded only after the transaction commits, so a rolled-back sale never
    // leaks out to the other machine.
    for (const l of soldLines) {
      recordEvent('stock.delta', { product_id: l.product_id, delta: -l.quantity, reason: 'sale',
        reference: saleId, movement_id: l.movement_id, batch_id: l.batch_id, ts: now });
    }
    recordEvent('sale.created', { id: saleId, receipt_no: receiptNo, subtotal, discount_type: dType,
      discount_value: dValue, discount_amount: discountAmount, total, payment_method: (payment_method || 'cash').toLowerCase(),
      customer_amount: custAmt, change_amount: changeAmt, cashier_id: cashier_id || null, notes: notes || null,
      created_at: now, items: soldLines });
    result = { subtotal, discountAmount, total, changeAmt };
    log.info('[IPC sales:create] success', { saleId, receiptNo });
    return { ok: true, data: { id: saleId, receipt_no: receiptNo, ...result } };
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch {}
    log.error('[IPC sales:create] failed', e);
    return { ok: false, error: e?.message || 'SALE_FAILED' };
  }
});

ipcMain.handle('sales:summaryToday', () => {
  const db = getDb();
  const start = new Date(); start.setHours(0,0,0,0);
  const end = new Date(); end.setHours(23,59,59,999);
  const rows = db.prepare('SELECT total, created_at FROM sales WHERE voided_at IS NULL AND created_at >= ? AND created_at <= ?')
    .all(start.toISOString(), end.toISOString()) as any[];
  const totalSales = rows.reduce((a, c) => a + Number(c.total || 0), 0);
  return { ok: true, data: { totalSales, transactions: rows.length } };
});
