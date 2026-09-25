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
