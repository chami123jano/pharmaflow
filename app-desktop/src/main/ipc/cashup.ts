/**
 * End-of-day cash-up.
 *
 * What should be in the drawer is worked out from the bills: the float it
 * started with, plus cash taken, minus cash given back. The cashier counts
 * what is actually there and the difference is recorded — over, short or
 * balanced — with who counted and when.
 *
 * Each cash-up covers everything since the previous one on this PC, so a
 * forgotten evening is folded into the next rather than lost. The first ever
 * starts from the beginning of today.
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';
import log from '../log.js';
import { recordEvent, getDeviceId } from '../sync/events.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

function periodStart(db: any, device: string): string {
  const last = db.prepare('SELECT period_end FROM cash_ups WHERE device = ? ORDER BY period_end DESC LIMIT 1').get(device) as any;
  if (last?.period_end) return last.period_end;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** The figures for the period, without saving anything. */
export function cashFigures(db: any, start: string, end: string) {
  const sales = db.prepare(`SELECT payment_method, total FROM sales WHERE voided_at IS NULL AND created_at > ? AND created_at <= ?`).all(start, end) as any[];
  const rets = db.prepare(`SELECT method, refund_total FROM sale_returns r JOIN sales s ON s.id = r.sale_id
                           WHERE s.voided_at IS NULL AND r.created_at > ? AND r.created_at <= ?`).all(start, end) as any[];
  const isCash = (m: any) => String(m || 'cash').toLowerCase() === 'cash';
  const cashSales = r2(sales.filter((s) => isCash(s.payment_method)).reduce((a, s) => a + Number(s.total || 0), 0));
  const cardSales = r2(sales.filter((s) => !isCash(s.payment_method)).reduce((a, s) => a + Number(s.total || 0), 0));
  const cashRefunds = r2(rets.filter((r) => isCash(r.method)).reduce((a, r) => a + Number(r.refund_total || 0), 0));
  const cardRefunds = r2(rets.filter((r) => !isCash(r.method)).reduce((a, r) => a + Number(r.refund_total || 0), 0));
  return { salesCount: sales.length, cashSales, cardSales, cashRefunds, cardRefunds, returnsCount: rets.length };
}

ipcMain.handle('cashup:preview', () => {
  const db = getDb();
  try {
    const device = getDeviceId();
    const start = periodStart(db, device);
    const end = new Date().toISOString();
    const lastFloat = Number((db.prepare("SELECT value FROM settings WHERE key = 'cashup.float'").get() as any)?.value || 0);
    return { ok: true, data: { periodStart: start, periodEnd: end, float: lastFloat, ...cashFigures(db, start, end) } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'PREVIEW_FAILED' };
  }
});

ipcMain.handle('cashup:save', (_e, input: { float?: number; counted: number; denominations?: any; notes?: string; user_id?: string }) => {
  const db = getDb();
  try {
    const counted = Number(input?.counted);
    const float = Number(input?.float || 0);
    if (!Number.isFinite(counted) || counted < 0) return { ok: false, error: 'BAD_COUNT', message: 'Enter the cash you counted' };
    if (!Number.isFinite(float) || float < 0) return { ok: false, error: 'BAD_FLOAT', message: 'The float must be zero or more' };

    const device = getDeviceId();
    const start = periodStart(db, device);
    const end = new Date().toISOString();
    const f = cashFigures(db, start, end);
    const expected = r2(float + f.cashSales - f.cashRefunds);
    const difference = r2(counted - expected);
    const u = input.user_id ? (db.prepare('SELECT name, username FROM users WHERE id = ?').get(input.user_id) as any) : null;
    const row = {
      id: randomUUID(), period_start: start, period_end: end, float_amount: r2(float),
      cash_sales: f.cashSales, card_sales: f.cardSales, cash_refunds: f.cashRefunds, card_refunds: f.cardRefunds,
      sales_count: f.salesCount, expected_cash: expected, counted_cash: r2(counted), difference,
      denominations: input.denominations ? JSON.stringify(input.denominations) : null,
      notes: (input.notes || '').trim() || null, created_by: input.user_id || null,
      created_by_name: u?.name || u?.username || null, device, created_at: end,
    };
    db.prepare(`INSERT INTO cash_ups (id,period_start,period_end,float_amount,cash_sales,card_sales,cash_refunds,card_refunds,sales_count,
                expected_cash,counted_cash,difference,denominations,notes,created_by,created_by_name,device,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.id, row.period_start, row.period_end, row.float_amount, row.cash_sales, row.card_sales, row.cash_refunds, row.card_refunds,
           row.sales_count, row.expected_cash, row.counted_cash, row.difference, row.denominations, row.notes,
           row.created_by, row.created_by_name, row.device, row.created_at);
    // Tomorrow's float is usually today's; offer it again.
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('cashup.float', ?)").run(String(row.float_amount));
    recordEvent('cashup.created', row);
    log.info('[IPC cashup:save]', { expected, counted, difference });
    return { ok: true, data: { ...row, returnsCount: f.returnsCount } };
  } catch (err: any) {
    log.error('[IPC cashup:save] failed', err);
    return { ok: false, error: 'SAVE_FAILED', message: err?.message || 'Could not save the cash-up' };
  }
});

ipcMain.handle('cashup:list', (_e, limit = 100) => {
  const db = getDb();
  try {
    return { ok: true, data: db.prepare('SELECT * FROM cash_ups ORDER BY created_at DESC LIMIT ?').all(Math.min(Number(limit) || 100, 1000)) };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'LIST_FAILED' };
  }
});
