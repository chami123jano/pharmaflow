import { ipcMain } from 'electron';
import { getDb } from '../db/index.js';

function getDateBounds(range?: string, from?: string, to?: string): { start?: string; end?: string } {
  if (from && to) {
    const s = new Date(from); s.setHours(0,0,0,0);
    const e = new Date(to);   e.setHours(23,59,59,999);
    return { start: s.toISOString(), end: e.toISOString() };
  }
  if (!range) return {};
  const now = new Date();
  const end = new Date(now); end.setHours(23,59,59,999);
  const start = new Date(now);
  switch ((range||'').toLowerCase()) {
    case 'today':   start.setHours(0,0,0,0); break;
    case 'week': case '7d': start.setDate(start.getDate()-6); start.setHours(0,0,0,0); break;
    case 'month':   start.setMonth(start.getMonth()-1); start.setHours(0,0,0,0); break;
    case 'quarter': start.setMonth(start.getMonth()-3); start.setHours(0,0,0,0); break;
    case 'year':    start.setFullYear(start.getFullYear()-1); start.setHours(0,0,0,0); break;
    default: return {};
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

ipcMain.handle('reports:lowStock', (_e, threshold = 10) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id,name,sku,stock,category,supplier,price FROM products WHERE stock <= ? ORDER BY stock ASC'
  ).all(Number(threshold) || 10);
  return { ok: true, data: rows };
});

ipcMain.handle('reports:nearExpiry', (_e, days = 30) => {
  const db = getDb();
  const now = Date.now();
  const cutoff = now + Number(days || 30) * 24*60*60*1000;
  const rows = db.prepare('SELECT id,name,sku,expiry,stock,category FROM products WHERE expiry IS NOT NULL').all() as any[];
  const filtered = rows.filter(r => {
    const t = Date.parse(r.expiry);
    return !isNaN(t) && t <= cutoff;
  }).sort((a,b) => Date.parse(a.expiry) - Date.parse(b.expiry));
  return { ok: true, data: filtered };
});

ipcMain.handle('reports:salesTrend', (_e, range?: string, from?: string, to?: string) => {
  const db = getDb();
  const { start, end } = getDateBounds(range, from, to);
  let sql = 'SELECT created_at, total FROM sales WHERE voided_at IS NULL';
  const params: any[] = [];
  if (start && end) { sql += ' AND created_at >= ? AND created_at <= ?'; params.push(start, end); }
  sql += ' ORDER BY created_at ASC';
  const rows = db.prepare(sql).all(...params) as any[];
  const byDay = new Map<string, { amount: number; transactions: number }>();
  rows.forEach(r => {
    const day = r.created_at.slice(0,10);
    const cur = byDay.get(day) || { amount: 0, transactions: 0 };
    cur.amount += Number(r.total || 0);
    cur.transactions += 1;
    byDay.set(day, cur);
  });
  const trend = Array.from(byDay.entries())
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, value: v.amount, transactions: v.transactions }));
  return { ok: true, data: trend };
});

ipcMain.handle('reports:salesSummary', (_e, range?: string, from?: string, to?: string) => {
  const db = getDb();
  const { start, end } = getDateBounds(range, from, to);
  const where = start && end
    ? 'WHERE voided_at IS NULL AND created_at >= ? AND created_at <= ?'
    : 'WHERE voided_at IS NULL';
  const params: any[] = start && end ? [start, end] : [];
  const sales = db.prepare(`SELECT id, total, discount_amount FROM sales ${where}`).all(...params) as any[];
  const totalSales = sales.reduce((s,r) => s + Number(r.total||0), 0);
  const totalDiscount = sales.reduce((s,r) => s + Number(r.discount_amount||0), 0);
  const totalTransactions = sales.length;
  const averageTransaction = totalTransactions ? totalSales / totalTransactions : 0;

  const whereJoin = start && end
    ? 'WHERE s.voided_at IS NULL AND s.created_at >= ? AND s.created_at <= ?'
    : 'WHERE s.voided_at IS NULL';
  const topRows = db.prepare(`
    SELECT p.name, p.sku, SUM(si.quantity) as qty, SUM(si.line_total) as revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    ${whereJoin}
    GROUP BY si.product_id ORDER BY qty DESC LIMIT 10
  `).all(...params) as any[];

  const topProduct = topRows.length ? `${topRows[0].name} (${Number(topRows[0].qty)})` : '-';
  return { ok: true, data: { totalSales, totalDiscount, totalTransactions, averageTransaction, topProduct, topProducts: topRows } };
});

ipcMain.handle('reports:salesDetail', (_e, range?: string, from?: string, to?: string) => {
  const db = getDb();
  const { start, end } = getDateBounds(range, from, to);
  const where = start && end
    ? 'WHERE s.voided_at IS NULL AND s.created_at >= ? AND s.created_at <= ?'
    : 'WHERE s.voided_at IS NULL';
  const params: any[] = start && end ? [start, end] : [];
  const rows = db.prepare(`
    SELECT s.id, s.receipt_no, s.subtotal, s.discount_type, s.discount_value, s.discount_amount,
           s.total, s.payment_method, s.customer_amount, s.change_amount, s.created_at,
           u.name as cashier_name
    FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
    ${where} ORDER BY s.created_at DESC
  `).all(...params);
  return { ok: true, data: rows };
});

ipcMain.handle('reports:topProducts', (_e, range?: string, from?: string, to?: string) => {
  const db = getDb();
  const { start, end } = getDateBounds(range, from, to);
  const where = start && end
    ? 'WHERE s.voided_at IS NULL AND s.created_at >= ? AND s.created_at <= ?'
    : 'WHERE s.voided_at IS NULL';
  const params: any[] = start && end ? [start, end] : [];
  const rows = db.prepare(`
    SELECT p.id, p.name, p.sku, p.category, p.price,
           SUM(si.quantity) as total_qty, SUM(si.line_total) as total_revenue,
           COUNT(DISTINCT si.sale_id) as sale_count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    ${where}
    GROUP BY si.product_id ORDER BY total_qty DESC
  `).all(...params);
  return { ok: true, data: rows };
});

ipcMain.handle('reports:stockMovements', (_e, productId?: string) => {
  const db = getDb();
  const where = productId ? 'WHERE sm.product_id = ?' : '';
  const params: any[] = productId ? [productId] : [];
  const rows = db.prepare(`
    SELECT sm.*, p.name as product_name, p.sku, u.name as user_name
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    LEFT JOIN users u ON u.id = sm.created_by
    ${where} ORDER BY sm.created_at DESC LIMIT 500
  `).all(...params);
  return { ok: true, data: rows };
});

ipcMain.handle('reports:inventoryValue', () => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT category, COUNT(*) as count, SUM(price*stock) as value, SUM(stock) as total_stock FROM products GROUP BY category ORDER BY value DESC'
  ).all();
  const total = db.prepare('SELECT SUM(price*stock) as value, COUNT(*) as count FROM products').get() as any;
  return { ok: true, data: { byCategory: rows, total } };
});

/**
 * Profit, worked out line by line.
 *
 *   profit = what the customer paid for the line − what those units cost
 *
 * "What they paid" is the line total less its share of the bill's discount, so
 * a 10% discount comes off the profit as well as the takings. "What they cost"
 * is the cost frozen on the sale line when it sold (the exact delivery it came
 * out of). Sales made before costs were recorded fall back to the batch's or
 * item's cost today and are counted as estimated.
 *
 * A line with no cost anywhere is NOT treated as costing nothing — that would
 * report its whole price as profit. It is left out of profit and margin and
 * listed separately, so the owner can see exactly what is missing.
 */
export function profitReport(db: any, start?: string, end?: string) {
  const where = start && end
    ? 'WHERE s.voided_at IS NULL AND s.created_at >= ? AND s.created_at <= ?'
    : 'WHERE s.voided_at IS NULL';
  const params: any[] = start && end ? [start, end] : [];
  const rows = db.prepare(`
    SELECT si.product_id, si.quantity, si.line_total, si.unit_cost,
           b.cost_price AS batch_cost, p.cost_price AS product_cost,
           COALESCE(p.name, 'Deleted item') AS name, p.sku, p.category,
           s.id AS sale_id, s.created_at, s.subtotal, s.discount_amount
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN product_batches b ON b.id = si.batch_id
    LEFT JOIN products p ON p.id = si.product_id
    ${where}
  `).all(...params) as any[];

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA'); // YYYY-MM-DD, shop's own clock

  const totals = { sales: 0, revenue: 0, costed: 0, cost: 0, profit: 0, discount: 0, uncostedRevenue: 0, uncostedLines: 0, estimatedLines: 0 };
  const saleIds = new Set<string>();
  const discounted = new Set<string>();
  const byDay = new Map<string, any>();
  const byItem = new Map<string, any>();
  const missing = new Map<string, any>();

  for (const r of rows) {
    const share = Number(r.subtotal) > 0 ? Number(r.line_total) / Number(r.subtotal) : 0;
    const disc = Number(r.discount_amount || 0) * share;
    const net = Number(r.line_total || 0) - disc;
    const frozen = r.unit_cost != null;
    const unit = frozen ? Number(r.unit_cost) : (r.batch_cost != null ? Number(r.batch_cost) : (r.product_cost != null ? Number(r.product_cost) : null));

    saleIds.add(r.sale_id);
    if (!discounted.has(r.sale_id)) { discounted.add(r.sale_id); totals.discount += Number(r.discount_amount || 0); }
    totals.revenue += net;

    const day = localDay(r.created_at);
    const d = byDay.get(day) || { date: day, revenue: 0, cost: 0, profit: 0, costedRevenue: 0, sales: new Set<string>() };
    d.revenue += net; d.sales.add(r.sale_id);

    const it = byItem.get(r.product_id) || { product_id: r.product_id, name: r.name, sku: r.sku, category: r.category,
      qty: 0, revenue: 0, cost: 0, profit: 0, costedRevenue: 0, uncostedQty: 0 };
    it.qty += Number(r.quantity || 0); it.revenue += net;

    if (unit == null) {
      totals.uncostedRevenue += net; totals.uncostedLines++;
      it.uncostedQty += Number(r.quantity || 0);
      const m = missing.get(r.product_id) || { product_id: r.product_id, name: r.name, sku: r.sku, qty: 0, revenue: 0 };
      m.qty += Number(r.quantity || 0); m.revenue += net; missing.set(r.product_id, m);
    } else {
      if (!frozen) totals.estimatedLines++;
      const cost = unit * Number(r.quantity || 0);
      totals.costed += net; totals.cost += cost;
      d.costedRevenue += net; d.cost += cost;
      it.costedRevenue += net; it.cost += cost;
    }
    byDay.set(day, d); byItem.set(r.product_id, it);
  }

  const margin = (profit: number, rev: number) => (rev > 0 ? r2((profit / rev) * 100) : null);
  totals.sales = saleIds.size;
  totals.profit = totals.costed - totals.cost;

  return {
    summary: {
      salesCount: totals.sales,
      revenue: r2(totals.revenue),
      discount: r2(totals.discount),
      costedRevenue: r2(totals.costed),
      cost: r2(totals.cost),
      profit: r2(totals.profit),
      margin: margin(totals.profit, totals.costed),
      uncostedRevenue: r2(totals.uncostedRevenue),
      uncostedLines: totals.uncostedLines,
      estimatedLines: totals.estimatedLines,
    },
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
      date: d.date, sales: d.sales.size, revenue: r2(d.revenue), cost: r2(d.cost),
      profit: r2(d.costedRevenue - d.cost), margin: margin(d.costedRevenue - d.cost, d.costedRevenue),
      complete: r2(d.costedRevenue) === r2(d.revenue),
    })),
    byItem: [...byItem.values()].map((i) => ({
      ...i, revenue: r2(i.revenue), cost: r2(i.cost), profit: r2(i.costedRevenue - i.cost),
      margin: margin(i.costedRevenue - i.cost, i.costedRevenue), complete: i.uncostedQty === 0,
    })).sort((a, b) => b.profit - a.profit),
    missingCost: [...missing.values()].map((m) => ({ ...m, revenue: r2(m.revenue) })).sort((a, b) => b.revenue - a.revenue),
  };
}

ipcMain.handle('reports:profit', (_e, range?: string, from?: string, to?: string) => {
  try {
    const db = getDb();
    const { start, end } = getDateBounds(range, from, to);
    const data: any = profitReport(db, start, end);

    // What is on the shelf now, at what it cost and at what it will sell for.
    const stock = db.prepare(`
      SELECT SUM(b.qty_remaining * COALESCE(b.cost_price, p.cost_price)) AS at_cost,
             SUM(CASE WHEN COALESCE(b.cost_price, p.cost_price) IS NULL THEN b.qty_remaining ELSE 0 END) AS units_no_cost,
             SUM(b.qty_remaining * p.price) AS at_price
      FROM product_batches b JOIN products p ON p.id = b.product_id WHERE b.qty_remaining > 0
    `).get() as any;
    data.stock = {
      atCost: Number(stock?.at_cost || 0), atPrice: Number(stock?.at_price || 0),
      unitsWithoutCost: Number(stock?.units_no_cost || 0),
    };
    // Items priced at or below what they cost — every sale of these loses money.
    data.belowCost = db.prepare(`SELECT id, name, sku, price, cost_price FROM products
      WHERE cost_price IS NOT NULL AND price > 0 AND price <= cost_price ORDER BY name`).all();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'PROFIT_FAILED' };
  }
});
