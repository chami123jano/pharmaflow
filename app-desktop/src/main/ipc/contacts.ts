/**
 * Customers and suppliers.
 *
 * Both are optional wherever they are used. A sale must go through whether or
 * not anybody typed a name, and a delivery must record its stock whether or
 * not the supplier exists as a record yet.
 */
import { ipcMain } from 'electron';
import { getDb } from '../db/index.js';
import { randomUUID } from 'crypto';
import log from '../log.js';

type Kind = 'customers' | 'suppliers';

function listOf(kind: Kind, search?: string) {
  const db = getDb();
  const q = (search || '').trim().toLowerCase();
  if (!q) return db.prepare(`SELECT * FROM ${kind} ORDER BY name ASC LIMIT 500`).all();
  const like = `%${q}%`;
  return db.prepare(`
    SELECT * FROM ${kind}
    WHERE lower(name) LIKE ?
       OR lower(COALESCE(phone, '')) LIKE ?
       OR lower(COALESCE(email, '')) LIKE ?
    ORDER BY name ASC LIMIT 500
  `).all(like, like, like);
}

function createIn(kind: Kind, payload: any) {
  const db = getDb();
  const name = String(payload?.name || '').trim();
  if (!name) return { ok: false, error: 'NAME_REQUIRED', message: 'A name is required' };

  // The same name and phone twice is nearly always a slip at the counter.
  const phone = String(payload?.phone || '').trim();
  const dupe = db.prepare(
    `SELECT id FROM ${kind} WHERE lower(name) = lower(?) AND COALESCE(phone, '') = ?`
  ).get(name, phone) as any;
  if (dupe) return { ok: false, error: 'DUPLICATE', message: 'That name and phone is already on the list' };

  const id = randomUUID();
  const now = new Date().toISOString();

  if (kind === 'suppliers') {
    db.prepare(`INSERT INTO suppliers (id,name,phone,email,address,contact_person,notes,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, name, phone || null, payload?.email || null, payload?.address || null,
           payload?.contact_person || null, payload?.notes || null, now, now);
  } else {
    db.prepare(`INSERT INTO customers (id,name,phone,email,address,notes,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, name, phone || null, payload?.email || null, payload?.address || null,
           payload?.notes || null, now, now);
  }

  log.info(`[IPC ${kind}:create]`, { id, name });
  return { ok: true, data: db.prepare(`SELECT * FROM ${kind} WHERE id = ?`).get(id) };
}

function updateIn(kind: Kind, id: string, patch: any) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM ${kind} WHERE id = ?`).get(id) as any;
  if (!existing) return { ok: false, error: 'NOT_FOUND' };

  const m = { ...existing, ...patch, updated_at: new Date().toISOString() };
  if (!String(m.name || '').trim()) return { ok: false, error: 'NAME_REQUIRED', message: 'A name is required' };

  if (kind === 'suppliers') {
    db.prepare(`UPDATE suppliers SET name=?,phone=?,email=?,address=?,contact_person=?,notes=?,updated_at=? WHERE id=?`)
      .run(m.name, m.phone || null, m.email || null, m.address || null,
           m.contact_person || null, m.notes || null, m.updated_at, id);
  } else {
    db.prepare(`UPDATE customers SET name=?,phone=?,email=?,address=?,notes=?,updated_at=? WHERE id=?`)
      .run(m.name, m.phone || null, m.email || null, m.address || null, m.notes || null, m.updated_at, id);
  }
  return { ok: true };
}

/** Kept rather than deleted when history still points at them. */
function removeFrom(kind: Kind, id: string) {
  const db = getDb();
  try {
    if (kind === 'customers') {
      const used = db.prepare('SELECT COUNT(1) AS c FROM sales WHERE customer_id = ?').get(id) as any;
      const n = Number(used?.c || 0);
      if (n > 0) return { ok: false, error: 'IN_USE', message: `On ${n} bill(s) — cannot be removed` };
    } else {
      const used = db.prepare('SELECT COUNT(1) AS c FROM product_batches WHERE supplier_id = ?').get(id) as any;
      const n = Number(used?.c || 0);
      if (n > 0) return { ok: false, error: 'IN_USE', message: `On ${n} delivery(s) — cannot be removed` };
    }
    db.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'DELETE_FAILED' };
  }
}

for (const kind of ['customers', 'suppliers'] as Kind[]) {
  ipcMain.handle(`${kind}:list`, (_e, search?: string) => {
    try { return { ok: true, data: listOf(kind, search) }; }
    catch (err: any) { return { ok: false, error: err?.message || 'LIST_FAILED' }; }
  });

  ipcMain.handle(`${kind}:create`, (_e, payload: any) => {
    try { return createIn(kind, payload); }
    catch (err: any) {
      log.error(`[IPC ${kind}:create] failed`, err);
      return { ok: false, error: err?.message || 'CREATE_FAILED' };
    }
  });

  ipcMain.handle(`${kind}:update`, (_e, id: string, patch: any) => {
    try { return updateIn(kind, id, patch); }
    catch (err: any) { return { ok: false, error: err?.message || 'UPDATE_FAILED' }; }
  });

  ipcMain.handle(`${kind}:delete`, (_e, id: string) => removeFrom(kind, id));
}

/** What this customer has bought, most recent first. */
ipcMain.handle('customers:history', (_e, id: string, limit = 50) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT id, receipt_no, total, payment_method, created_at, voided_at
      FROM sales WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(id, limit) as any[];
    const live = rows.filter((r) => !r.voided_at);
    return {
      ok: true,
      data: {
        sales: rows,
        visits: live.length,
        totalSpent: live.reduce((s, r) => s + Number(r.total || 0), 0),
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'HISTORY_FAILED' };
  }
});

/** What has been bought from this supplier, and what it cost. */
ipcMain.handle('suppliers:history', (_e, id: string, limit = 100) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT b.*, p.name AS product_name
      FROM product_batches b JOIN products p ON p.id = b.product_id
      WHERE b.supplier_id = ? ORDER BY b.created_at DESC LIMIT ?
    `).all(id, limit) as any[];
    return {
      ok: true,
      data: {
        batches: rows,
        deliveries: rows.length,
        totalValue: rows.reduce((s, r) => s + Number(r.qty_received || 0) * Number(r.cost_price || 0), 0),
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'HISTORY_FAILED' };
  }
});
