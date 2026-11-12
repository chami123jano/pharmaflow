/**
 * Supplier bills: what the shop owes, when, and what has been paid.
 *
 * A bill is made for every delivery received through a GRN — paid on the spot
 * or on credit (30, 45, 60 days or any number) — and can be added by hand for
 * debts from before the app. Any number of payments can be made against one
 * bill: half on the due date and the rest later is normal, and each payment
 * keeps how it was paid (cash, cheque with its number and date, or bank).
 *
 * `paid` on the bill is always recomputed from its live payments, never
 * nudged by +/- arithmetic, so it cannot drift from the payments list.
 *
 * Paying and adding bills is the owner's job: admin only, role read from the
 * database. The one exception is "paid now" on a GRN, which is part of
 * receiving the delivery.
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';
import log from '../log.js';
import { recordEvent, getDeviceId } from '../sync/events.js';

const r2 = (n: number) => Math.round(n * 100) / 100;
const isDate = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export const localToday = () => new Date().toLocaleDateString('en-CA');

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  return d.toLocaleDateString('en-CA');
}
const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 864e5);

function userOf(db: any, id?: string) {
  return id ? (db.prepare('SELECT id, role, name, username FROM users WHERE id = ?').get(id) as any) || null : null;
}
const isAdmin = (u: any) => String(u?.role || '').toLowerCase() === 'admin';

/** Re-adds a bill's live payments and stores the total. Caller owns any transaction. */
export function refreshPaid(db: any, billId: string) {
  const row = db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM supplier_payments WHERE bill_id = ? AND voided_at IS NULL').get(billId) as any;
  db.prepare('UPDATE supplier_bills SET paid = ? WHERE id = ?').run(r2(Number(row?.n || 0)), billId);
}

/** What the lists show: balance, and how the due date stands today. */
function shape(b: any, today = localToday()) {
  const balance = r2(Number(b.amount || 0) - Number(b.paid || 0));
  const days = b.due_date ? daysBetween(today, b.due_date) : null;
  let status: string;
  if (b.voided_at) status = 'cancelled';
  else if (balance <= 0.005) status = 'paid';
  else if (days == null) status = 'open';
  else if (days < 0) status = 'overdue';
  else if (days === 0) status = 'today';
  else if (days <= 7) status = 'soon';
  else status = 'later';
  return { ...b, balance: Math.max(0, balance), days_left: days, status };
}

function nextBillNo(db: any, device: string) {
  return Number((db.prepare('SELECT COALESCE(MAX(bill_no),0) AS n FROM supplier_bills WHERE device = ? OR device IS NULL').get(device) as any)?.n || 0) + 1;
}

interface PaymentIn {
  amount: number; method?: string; cheque_no?: string; cheque_date?: string; reference?: string;
  paid_on?: string; notes?: string;
}

function cleanPayment(p: PaymentIn) {
  const method = ['cash', 'cheque', 'bank'].includes(String(p.method)) ? String(p.method) : 'cash';
  return {
    method,
    cheque_no: method === 'cheque' ? (String(p.cheque_no || '').trim() || null) : null,
    cheque_date: method === 'cheque' && isDate(p.cheque_date) ? p.cheque_date! : null,
    reference: String(p.reference || '').trim() || null,
    paid_on: isDate(p.paid_on) ? p.paid_on! : localToday(),
    notes: String(p.notes || '').trim() || null,
  };
}

/** Inserts a payment row and refreshes the bill. Caller owns the transaction. */
export function insertPayment(db: any, billId: string, amount: number, p: PaymentIn, user: any, source: string | null) {
  const c = cleanPayment(p);
  const row = {
    id: randomUUID(), bill_id: billId, amount: r2(amount), ...c, source,
    created_by: user?.id || null, created_by_name: user?.name || user?.username || null,
    device: getDeviceId(), created_at: new Date().toISOString(),
  };
  db.prepare(`INSERT INTO supplier_payments (id,bill_id,amount,method,cheque_no,cheque_date,reference,paid_on,notes,source,created_by,created_by_name,device,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.id, row.bill_id, row.amount, row.method, row.cheque_no, row.cheque_date, row.reference, row.paid_on, row.notes,
         row.source, row.created_by, row.created_by_name, row.device, row.created_at);
  refreshPaid(db, billId);
  return row;
}

/**
 * Makes the bill for a GRN, inside the GRN's own transaction. "Paid now"
 * records the payment at once; credit sets the due date from the invoice
 * date (or today) and, if asked, remembers the days for this supplier.
 */
export function billForGrn(db: any, grn: any, pay: any, user: any) {
  const amount = r2(Number(grn.invoice_total ?? grn.total_cost ?? 0));
  if (!(amount > 0)) return null; // nothing priced, nothing owed
  const credit = pay?.mode === 'credit';
  const days = credit ? Math.max(0, Math.round(Number(pay?.days || 0))) : 0;
  const start = isDate(grn.invoice_date) ? grn.invoice_date : localToday();
  const device = getDeviceId();
  const bill = {
    id: randomUUID(), bill_no: nextBillNo(db, device), supplier_id: grn.supplier_id || null, supplier_name: grn.supplier_name || null,
    grn_id: grn.id, invoice_no: grn.invoice_no || null, invoice_date: start, amount, paid: 0,
    credit_days: credit ? days : 0, due_date: credit ? addDays(start, days) : start,
    notes: null, created_by: user?.id || null, created_by_name: user?.name || user?.username || null,
    device, created_at: new Date().toISOString(),
  };
  db.prepare(`INSERT INTO supplier_bills (id,bill_no,supplier_id,supplier_name,grn_id,invoice_no,invoice_date,amount,paid,credit_days,due_date,notes,created_by,created_by_name,device,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(bill.id, bill.bill_no, bill.supplier_id, bill.supplier_name, bill.grn_id, bill.invoice_no, bill.invoice_date, bill.amount, 0,
         bill.credit_days, bill.due_date, bill.notes, bill.created_by, bill.created_by_name, bill.device, bill.created_at);
  const payments: any[] = [];
  if (!credit) payments.push(insertPayment(db, bill.id, amount, { ...pay, paid_on: localToday() }, user, 'grn'));
  if (credit && grn.supplier_id && pay?.remember !== false) {
    db.prepare('UPDATE suppliers SET credit_days = ? WHERE id = ?').run(days, grn.supplier_id);
  }
  return { bill: { ...bill, paid: credit ? 0 : amount }, payments };
}

ipcMain.handle('bills:list', (_e, opts: { status?: 'unpaid' | 'paid' | 'all'; supplier_id?: string; search?: string } = {}) => {
  const db = getDb();
  try {
    const want = opts?.status || 'unpaid';
    const rows = db.prepare(`SELECT * FROM supplier_bills ${opts?.supplier_id ? 'WHERE supplier_id = ?' : ''}
                             ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, created_at ASC`)
      .all(...(opts?.supplier_id ? [opts.supplier_id] : [])) as any[];
    const q = String(opts?.search || '').trim().toLowerCase();
    const out = rows.map((b) => shape(b)).filter((b) => {
      if (want === 'unpaid' && (b.status === 'paid' || b.status === 'cancelled')) return false;
      if (want === 'paid' && b.status !== 'paid') return false;
      if (q && !`${b.supplier_name || ''} ${b.invoice_no || ''} ${b.bill_no}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (want === 'paid') out.reverse();
    return { ok: true, data: out };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'LIST_FAILED' };
  }
});

ipcMain.handle('bills:summary', () => {
  const db = getDb();
  try {
    const today = localToday();
    const open = (db.prepare('SELECT * FROM supplier_bills WHERE voided_at IS NULL AND amount - paid > 0.005').all() as any[]).map((b) => shape(b, today));
    const sum = (xs: any[]) => r2(xs.reduce((a, b) => a + b.balance, 0));
    const overdue = open.filter((b) => b.status === 'overdue');
    const week = open.filter((b) => b.status === 'today' || b.status === 'soon');
    const cheques = db.prepare(`SELECT p.*, b.supplier_name FROM supplier_payments p JOIN supplier_bills b ON b.id = p.bill_id
                                WHERE p.voided_at IS NULL AND p.method = 'cheque' AND p.cheque_date > ? ORDER BY p.cheque_date`).all(today) as any[];
    const monthStart = today.slice(0, 8) + '01';
    const paidMonth = Number((db.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM supplier_payments WHERE voided_at IS NULL AND paid_on >= ?`).get(monthStart) as any)?.n || 0);
    return {
      ok: true,
      data: {
        owed: sum(open), openCount: open.length,
        overdue: sum(overdue), overdueCount: overdue.length,
        dueWeek: sum(week), dueWeekCount: week.length,
        chequesPending: r2(cheques.reduce((a, c) => a + Number(c.amount || 0), 0)), cheques,
        paidThisMonth: r2(paidMonth),
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'SUMMARY_FAILED' };
  }
});

ipcMain.handle('bills:get', (_e, id: string) => {
  const db = getDb();
  try {
    const b = db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(id) as any;
    if (!b) return { ok: false, error: 'NOT_FOUND' };
    const payments = db.prepare('SELECT * FROM supplier_payments WHERE bill_id = ? ORDER BY paid_on, created_at').all(id);
    const grn = b.grn_id ? db.prepare('SELECT grn_no FROM grns WHERE id = ?').get(b.grn_id) : null;
    return { ok: true, data: { ...shape(b), payments, grn_no: (grn as any)?.grn_no ?? null } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'GET_FAILED' };
  }
});

/** A bill typed in by hand — usually money owed from before the app. */
ipcMain.handle('bills:create', (_e, input: any) => {
  const db = getDb();
  try {
    const user = userOf(db, input?.user_id);
    if (!isAdmin(user)) return { ok: false, error: 'FORBIDDEN', message: 'Only an admin can add a bill' };
    const amount = r2(Number(input?.amount));
    if (!(amount > 0)) return { ok: false, error: 'BAD_AMOUNT', message: 'Enter the amount owed' };
    let supplierName = String(input?.supplier_name || '').trim() || null;
    const supplierId = input?.supplier_id || null;
    if (supplierId) supplierName = (db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId) as any)?.name || supplierName;
    if (!supplierName) return { ok: false, error: 'NO_SUPPLIER', message: 'Choose the supplier' };
    const invoiceDate = isDate(input?.invoice_date) ? input.invoice_date : localToday();
    const days = Math.max(0, Math.round(Number(input?.credit_days || 0)));
    const due = isDate(input?.due_date) ? input.due_date : addDays(invoiceDate, days);
    const device = getDeviceId();
    const row = {
      id: randomUUID(), bill_no: nextBillNo(db, device), supplier_id: supplierId, supplier_name: supplierName, grn_id: null,
      invoice_no: String(input?.invoice_no || '').trim() || null, invoice_date: invoiceDate, amount, paid: 0,
      credit_days: days, due_date: due, notes: String(input?.notes || '').trim() || null,
      created_by: user.id, created_by_name: user.name || user.username, device, created_at: new Date().toISOString(),
    };
    db.prepare(`INSERT INTO supplier_bills (id,bill_no,supplier_id,supplier_name,grn_id,invoice_no,invoice_date,amount,paid,credit_days,due_date,notes,created_by,created_by_name,device,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.id, row.bill_no, row.supplier_id, row.supplier_name, row.grn_id, row.invoice_no, row.invoice_date, row.amount, 0,
           row.credit_days, row.due_date, row.notes, row.created_by, row.created_by_name, row.device, row.created_at);
    recordEvent('bill.created', { ...row, payments: [] });
    return { ok: true, data: shape(row) };
  } catch (err: any) {
    log.error('[IPC bills:create] failed', err);
    return { ok: false, error: 'CREATE_FAILED', message: err?.message || 'Could not add the bill' };
  }
});

/** A payment against a bill — the whole balance or any part of it. */
ipcMain.handle('bills:pay', (_e, input: any) => {
  const db = getDb();
  try {
    const user = userOf(db, input?.user_id);
    if (!isAdmin(user)) return { ok: false, error: 'FORBIDDEN', message: 'Only an admin can record a payment' };
    const b = db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(input?.bill_id) as any;
    if (!b) return { ok: false, error: 'NOT_FOUND', message: 'Bill not found' };
    if (b.voided_at) return { ok: false, error: 'CANCELLED', message: 'This bill was cancelled' };
    const amount = r2(Number(input?.amount));
    const balance = r2(Number(b.amount) - Number(b.paid));
    if (!(amount > 0)) return { ok: false, error: 'BAD_AMOUNT', message: 'Enter how much was paid' };
    if (amount > balance + 0.005) return { ok: false, error: 'TOO_MUCH', message: `Only Rs. ${balance.toFixed(2)} is left to pay on this bill` };
    if (input?.method === 'cheque' && !String(input?.cheque_no || '').trim()) return { ok: false, error: 'NO_CHEQUE', message: 'Enter the cheque number' };
    let p: any;
    db.transaction(() => { p = insertPayment(db, b.id, amount, input, user, null); })();
    recordEvent('bill.paid', p);
    const after = db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(b.id);
    log.info('[IPC bills:pay]', { bill: b.bill_no, amount });
    return { ok: true, data: { payment: p, bill: shape(after) } };
  } catch (err: any) {
    log.error('[IPC bills:pay] failed', err);
    return { ok: false, error: 'PAY_FAILED', message: err?.message || 'Could not record the payment' };
  }
});

/** Undoes a payment entered by mistake (it stays in the history, crossed out). */
ipcMain.handle('bills:voidPayment', (_e, paymentId: string, userId: string) => {
  const db = getDb();
  try {
    const user = userOf(db, userId);
    if (!isAdmin(user)) return { ok: false, error: 'FORBIDDEN', message: 'Only an admin can undo a payment' };
    const p = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(paymentId) as any;
    if (!p) return { ok: false, error: 'NOT_FOUND' };
    if (p.voided_at) return { ok: false, error: 'ALREADY', message: 'Already undone' };
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE supplier_payments SET voided_at = ?, voided_by = ? WHERE id = ?').run(now, user.name || user.username, paymentId);
      refreshPaid(db, p.bill_id);
    })();
    recordEvent('bill.payment_voided', { id: paymentId, bill_id: p.bill_id, voided_at: now, voided_by: user.name || user.username });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: 'VOID_FAILED', message: err?.message || 'Could not undo the payment' };
  }
});

/** Cancels a bill entered by mistake — only while nothing has been paid on it. */
ipcMain.handle('bills:void', (_e, billId: string, userId: string, reason?: string) => {
  const db = getDb();
  try {
    const user = userOf(db, userId);
    if (!isAdmin(user)) return { ok: false, error: 'FORBIDDEN', message: 'Only an admin can cancel a bill' };
    const b = db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(billId) as any;
    if (!b) return { ok: false, error: 'NOT_FOUND' };
    if (b.grn_id) return { ok: false, error: 'FROM_GRN', message: 'This bill belongs to a delivery — cancel the GRN instead' };
    if (Number(b.paid) > 0.005) return { ok: false, error: 'HAS_PAYMENTS', message: 'Payments were made on this bill — undo them first' };
    const now = new Date().toISOString();
    db.prepare('UPDATE supplier_bills SET voided_at = ?, void_reason = ? WHERE id = ?').run(now, String(reason || '').trim() || null, billId);
    recordEvent('bill.voided', { id: billId, voided_at: now, void_reason: String(reason || '').trim() || null });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: 'VOID_FAILED', message: err?.message || 'Could not cancel the bill' };
  }
});
