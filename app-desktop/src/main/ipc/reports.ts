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

/**
 * What is going out of date. Read from the deliveries (batches), which is where
 * expiry dates actually live — a GRN line has its own date. The item's single
 * `expiry` field was only ever typed once, on the Add form, so reading it
 * missed everything received since.
 */
ipcMain.handle('reports:nearExpiry', (_e, days = 30) => {
  const db = getDb();
  const cutoff = new Date(Date.now() + Number(days || 30) * 864e5).toLocaleDateString('en-CA');
  const rows = db.prepare(`
    SELECT p.id, p.name, p.sku, p.category, p.stock,
           MIN(b.expiry) AS expiry, SUM(b.qty_remaining) AS qty_expiring
    FROM product_batches b JOIN products p ON p.id = b.product_id
    WHERE b.qty_remaining > 0 AND b.expiry IS NOT NULL AND b.expiry <> '' AND substr(b.expiry,1,10) <= ?
    GROUP BY p.id ORDER BY MIN(b.expiry) ASC
  `).all(cutoff) as any[];
  return { ok: true, data: rows };
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
  // Money given back comes off the day it left the drawer.
  let rsql = 'SELECT r.refund_total, r.created_at FROM sale_returns r JOIN sales s ON s.id = r.sale_id WHERE s.voided_at IS NULL';
  const rparams: any[] = [];
  if (start && end) { rsql += ' AND r.created_at >= ? AND r.created_at <= ?'; rparams.push(start, end); }
  for (const r of db.prepare(rsql).all(...rparams) as any[]) {
    const day = r.created_at.slice(0,10);
    const cur = byDay.get(day) || { amount: 0, transactions: 0 };
    cur.amount -= Number(r.refund_total || 0);
    byDay.set(day, cur);
  }
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
  const refundWhere = start && end ? 'AND r.created_at >= ? AND r.created_at <= ?' : '';
  const totalRefunds = Number((db.prepare(`SELECT COALESCE(SUM(r.refund_total),0) AS n FROM sale_returns r JOIN sales s ON s.id = r.sale_id
    WHERE s.voided_at IS NULL ${refundWhere}`).get(...params) as any)?.n || 0);
  const totalSales = sales.reduce((s,r) => s + Number(r.total||0), 0) - totalRefunds;
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
  return { ok: true, data: { totalSales, totalDiscount, totalRefunds, totalTransactions, averageTransaction, topProduct, topProducts: topRows } };
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

  // Returns, on the day the money went back. Units put back on the shelf
  // return their cost too; units thrown away do not — that cost is lost.
  const retWhere = start && end
    ? 'WHERE s.voided_at IS NULL AND r.created_at >= ? AND r.created_at <= ?'
    : 'WHERE s.voided_at IS NULL';
  const rets = db.prepare(`
    SELECT ri.product_id, ri.qty, ri.refund, ri.unit_cost, ri.restocked, r.created_at,
           COALESCE(ri.product_name, p.name, 'Item') AS name, p.sku, p.category, p.cost_price AS product_cost
    FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id
    JOIN sales s ON s.id = r.sale_id LEFT JOIN products p ON p.id = ri.product_id
    ${retWhere}
  `).all(...params) as any[];
  let refunds = 0;
  for (const x of rets) {
    const refund = Number(x.refund || 0);
    refunds += refund;
    const unit = x.unit_cost != null ? Number(x.unit_cost) : (x.product_cost != null ? Number(x.product_cost) : null);
    const costBack = x.restocked && unit != null ? unit * Number(x.qty || 0) : 0;
    totals.revenue -= refund;
    const day = localDay(x.created_at);
    const d = byDay.get(day) || { date: day, revenue: 0, cost: 0, profit: 0, costedRevenue: 0, sales: new Set<string>() };
    d.revenue -= refund;
    const it = byItem.get(x.product_id) || { product_id: x.product_id, name: x.name, sku: x.sku, category: x.category,
      qty: 0, revenue: 0, cost: 0, profit: 0, costedRevenue: 0, uncostedQty: 0 };
    it.revenue -= refund;
    if (x.restocked) it.qty -= Number(x.qty || 0);
    if (unit == null) { totals.uncostedRevenue -= refund; }
    else {
      totals.costed -= refund; totals.cost -= costBack;
      d.costedRevenue -= refund; d.cost -= costBack;
      it.costedRevenue -= refund; it.cost -= costBack;
    }
    byDay.set(day, d); byItem.set(x.product_id, it);
  }

  const margin = (profit: number, rev: number) => (rev > 0 ? r2((profit / rev) * 100) : null);
  totals.sales = saleIds.size;
  totals.profit = totals.costed - totals.cost;

  return {
    summary: {
      salesCount: totals.sales,
      revenue: r2(totals.revenue),
      discount: r2(totals.discount),
      refunds: r2(refunds),
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


/**
 * What to order, and from whom.
 *
 * An item is on the list when it has run out, is down to 10 or fewer, or will
 * not last another week at the rate it sold over the last 30 days. The
 * suggested amount covers two weeks of that rate, less what is on the shelf.
 * An item that has never sold gets no suggestion — guessing would be worse
 * than leaving it to the owner.
 *
 * Grouped by who supplied it last (the latest delivery's supplier), falling
 * back to the supplier typed on the item.
 */
ipcMain.handle('reports:reorder', (_e, days = 30, coverDays = 14) => {
  try {
    const db = getDb();
    const since = new Date(Date.now() - Number(days || 30) * 864e5).toISOString();
    const rows = db.prepare(`
      SELECT p.id, p.name, p.sku, p.category, p.stock, p.price, p.cost_price, p.supplier AS typed_supplier,
             COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                       WHERE si.product_id = p.id AND s.voided_at IS NULL AND s.created_at >= ?), 0)
           - COALESCE((SELECT SUM(ri.qty) FROM sale_return_items ri JOIN sale_returns r ON r.id = ri.return_id
                       WHERE ri.product_id = p.id AND r.created_at >= ?), 0) AS sold,
             (SELECT b.supplier_id FROM product_batches b WHERE b.product_id = p.id AND (b.supplier_id IS NOT NULL OR b.supplier IS NOT NULL)
              ORDER BY b.created_at DESC LIMIT 1) AS last_supplier_id,
             (SELECT b.supplier FROM product_batches b WHERE b.product_id = p.id AND b.supplier IS NOT NULL
              ORDER BY b.created_at DESC LIMIT 1) AS last_supplier
      FROM products p
    `).all(since, since) as any[];
    const suppliers = new Map((db.prepare('SELECT id, name, phone, contact_person FROM suppliers').all() as any[]).map((s) => [s.id, s]));
    const byName = new Map([...suppliers.values()].map((s: any) => [String(s.name).trim().toLowerCase(), s]));

    const items = rows.map((r) => {
      const perDay = Math.max(0, Number(r.sold || 0)) / Number(days || 30);
      const stock = Number(r.stock || 0);
      const daysLeft = perDay > 0 ? stock / perDay : null;
      const need = stock <= 0 || stock <= 10 || (daysLeft != null && daysLeft < 7);
      const suggest = perDay > 0 ? Math.max(0, Math.ceil(perDay * Number(coverDays || 14) - stock)) : null;
      const sup: any = (r.last_supplier_id && suppliers.get(r.last_supplier_id))
        || byName.get(String(r.last_supplier || r.typed_supplier || '').trim().toLowerCase()) || null;
      return {
        id: r.id, name: r.name, sku: r.sku, category: r.category, stock, sold: Math.max(0, Number(r.sold || 0)),
        perDay: Math.round(perDay * 100) / 100, daysLeft: daysLeft == null ? null : Math.floor(daysLeft),
        suggest, cost: r.cost_price, need,
        supplier_id: sup?.id || null,
        supplier: sup?.name || (String(r.last_supplier || r.typed_supplier || '').trim() || null),
        phone: sup?.phone || null,
      };
    }).filter((i) => i.need);

    const groups = new Map<string, any>();
    for (const i of items) {
      const k = i.supplier || '';
      const g = groups.get(k) || { supplier: i.supplier, supplier_id: i.supplier_id, phone: i.phone, items: [] as any[] };
      g.items.push(i);
      groups.set(k, g);
    }
    const out = [...groups.values()].map((g) => ({
      ...g, items: g.items.sort((a: any, b: any) => (a.stock - b.stock) || String(a.name).localeCompare(String(b.name))),
    })).sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1) || String(a.supplier).localeCompare(String(b.supplier)));
    return { ok: true, data: { groups: out, count: items.length, days, coverDays } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'REORDER_FAILED' };
  }
});
