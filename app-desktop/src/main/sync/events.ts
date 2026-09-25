/**
 * The change log that makes home and shop agree.
 *
 * Two machines both run the full app offline, so neither can be the authority.
 * Instead each records what it *did* and replays what the other did. The rules
 * that keep this correct:
 *
 *   - Every device only ever appends to its own log. Two devices never write
 *     the same file, so a merge conflict is impossible by construction.
 *   - Stock never travels as an absolute number. It moves only as deltas, so a
 *     sale at the shop and a restock from home both land instead of one
 *     overwriting the other. This is the rule that stops sales being erased.
 *   - Every event carries a unique id and is applied at most once, so syncing
 *     twice is harmless.
 */
import { getDb } from '../db/index.js';
import { randomUUID } from 'crypto';
import log from '../log.js';
import { recomputeStock } from '../db/batches.js';

export type EventType = 'product.upsert' | 'product.delete' | 'stock.delta' | 'sale.created';

export interface SyncEvent {
  id: string;
  device: string;
  type: EventType;
  ts: string;
  payload: any;
}

let _deviceId: string | null = null;

/** Stable per-installation id; generated once and kept in settings. */
export function getDeviceId(): string {
  if (_deviceId) return _deviceId;
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'sync.device_id'").get() as any;
    if (row?.value) { _deviceId = row.value; return _deviceId!; }
  } catch {}
  const id = 'dev-' + randomUUID().slice(0, 8);
  try { db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('sync.device_id', id); } catch {}
  _deviceId = id;
  return id;
}

export function getDeviceLabel(): string {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'sync.device_label'").get() as any;
    if (row?.value) return row.value;
  } catch {}
  return getDeviceId();
}

/** Appends one event to this device's outbox. */
export function recordEvent(type: EventType, payload: any): void {
  try {
    // Resolved before the insert on purpose. On a fresh database getDeviceId
    // writes the new id to settings, and starting that write part-way through
    // building this one upsets the sql.js wrapper — the first event of the
    // database was being silently dropped.
    const device = getDeviceId();
    const db = getDb();
    db.prepare('INSERT INTO sync_events (id,device,type,ts,payload,pushed) VALUES (?,?,?,?,?,0)')
      .run(randomUUID(), device, type, new Date().toISOString(), JSON.stringify(payload));
  } catch (err: any) {
    // Recording must never break the operation the user actually asked for.
    log.error('[sync] could not record event', type, err?.message || String(err));
  }
}

export function unpushedEvents(): SyncEvent[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM sync_events WHERE pushed = 0 ORDER BY ts ASC').all() as any[];
  return rows.map((r) => ({ id: r.id, device: r.device, type: r.type, ts: r.ts, payload: safeParse(r.payload) }));
}

/**
 * Marks a batch as sent in as few writes as possible.
 *
 * One UPDATE per id would be correct but ruinous here: this wrapper rewrites
 * the whole database file after every write, so a sync of 500 events would
 * export tens of gigabytes. Chunked IN lists keep it to one write per chunk.
 */
export function markPushed(ids: string[]): void {
  if (!ids.length) return;
  const db = getDb();
  const CHUNK = 400; // stays well under SQLite's bound-parameter limit
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const holes = chunk.map(() => '?').join(',');
    db.prepare(`UPDATE sync_events SET pushed = 1 WHERE id IN (${holes})`).run(...chunk);
  }
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return {}; }
}

export function alreadyApplied(eventId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 AS x FROM sync_applied WHERE event_id = ?').get(eventId);
  return !!row;
}

/**
 * Applies one event from another device. Returns a short description of what
 * happened, or null when the event was already applied.
 */
export function applyEvent(ev: SyncEvent): string | null {
  const db = getDb();
  if (!ev?.id || alreadyApplied(ev.id)) return null;

  const now = new Date().toISOString();
  const p = ev.payload || {};

  switch (ev.type) {
    case 'product.upsert': {
      if (!p.id || !p.name) break;
      const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(p.id) as any;
      if (existing) {
        // Last edit wins on descriptive fields. Stock is deliberately absent
        // here — it only ever changes through stock.delta.
        if (!existing.updated_at || String(p.updated_at || '') >= String(existing.updated_at)) {
          db.prepare(`UPDATE products SET name=?, sku=?, price=?, expiry=?, description=?, supplier=?, category=?, generic_name=?, barcode=?, updated_at=? WHERE id=?`)
            .run(p.name, p.sku, p.price, p.expiry ?? null, p.description ?? null, p.supplier ?? null,
                 p.category ?? null, p.generic_name ?? null, p.barcode ?? null, p.updated_at || now, p.id);
        }
      } else {
        // A product arriving for the first time starts at zero; its opening
        // stock comes as its own delta event.
        db.prepare(`INSERT INTO products (id,name,sku,price,stock,expiry,description,supplier,category,generic_name,barcode,created_at,updated_at)
                    VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?)`)
          .run(p.id, p.name, p.sku, p.price, p.expiry ?? null, p.description ?? null, p.supplier ?? null,
               p.category ?? null, p.generic_name ?? null, p.barcode ?? null, p.created_at || now, p.updated_at || now);
      }
      break;
    }

    case 'product.delete': {
      if (!p.id) break;
      db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
      break;
    }

    case 'stock.delta': {
      const qty = Number(p.delta);
      if (!p.product_id || !Number.isFinite(qty) || qty === 0) break;
      const prod = db.prepare('SELECT id FROM products WHERE id = ?').get(p.product_id);
      if (!prod) break; // the product event has not arrived yet; skip rather than invent a row

      // Stock lives in batches, so a delta has to land on one. The batch id
      // travels with the event and is reused verbatim, which keeps the same
      // physical delivery identifiable on both machines.
      if (qty > 0) {
        const existing = p.batch_id ? db.prepare('SELECT id FROM product_batches WHERE id = ?').get(p.batch_id) : null;
        if (existing) {
          db.prepare('UPDATE product_batches SET qty_remaining = qty_remaining + ? WHERE id = ?').run(qty, p.batch_id);
        } else {
          db.prepare(`INSERT INTO product_batches (id,product_id,batch_no,expiry,qty_received,qty_remaining,notes,created_at)
                      VALUES (?,?,?,?,?,?,?,?)`)
            .run(p.batch_id || randomUUID(), p.product_id, p.batch_no || null, p.expiry || null,
                 qty, qty, 'from ' + ev.device, p.ts || ev.ts);
        }
      } else {
        const take = -qty;
        const target = p.batch_id ? db.prepare('SELECT * FROM product_batches WHERE id = ?').get(p.batch_id) as any : null;
        if (target) {
          db.prepare('UPDATE product_batches SET qty_remaining = MAX(0, qty_remaining - ?) WHERE id = ?').run(take, p.batch_id);
        } else {
          // The batch is unknown here — take it from the soonest-expiring stock
          // instead, so the totals still agree even if the split does not.
          let left = take;
          const rows = db.prepare(`SELECT id, qty_remaining FROM product_batches WHERE product_id = ? AND qty_remaining > 0
            ORDER BY CASE WHEN expiry IS NULL OR expiry = '' THEN 1 ELSE 0 END, expiry ASC`).all(p.product_id) as any[];
          for (const b of rows) {
            if (left <= 0) break;
            const t = Math.min(left, Number(b.qty_remaining));
            db.prepare('UPDATE product_batches SET qty_remaining = qty_remaining - ? WHERE id = ?').run(t, b.id);
            left -= t;
          }
        }
      }
      recomputeStock(db, p.product_id);
      db.prepare('INSERT OR IGNORE INTO stock_movements (id,product_id,type,quantity,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(p.movement_id || randomUUID(), p.product_id, p.reason || 'sync', qty, p.reference || null,
             'from ' + ev.device, null, p.ts || ev.ts);
      break;
    }

    case 'sale.created': {
      // Recorded for reporting on the other machine. Stock already moved via
      // its own delta events, so nothing is deducted here.
      if (!p.id) break;
      const exists = db.prepare('SELECT 1 AS x FROM sales WHERE id = ?').get(p.id);
      if (exists) break;
      db.prepare(`INSERT INTO sales (id,receipt_no,subtotal,discount_type,discount_value,discount_amount,total,payment_method,customer_amount,change_amount,cashier_id,notes,created_at,voided_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(p.id, p.receipt_no ?? null, p.subtotal ?? 0, p.discount_type || 'percent', p.discount_value ?? 0,
             p.discount_amount ?? 0, p.total ?? 0, p.payment_method || 'cash', p.customer_amount ?? 0,
             p.change_amount ?? 0, p.cashier_id ?? null, p.notes ?? null, p.created_at || ev.ts, p.voided_at ?? null);
      for (const it of p.items || []) {
        db.prepare('INSERT OR IGNORE INTO sale_items (id,sale_id,product_id,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)')
          .run(it.id || randomUUID(), p.id, it.product_id, it.quantity, it.unit_price, it.line_total);
      }
      break;
    }
  }

  db.prepare('INSERT OR IGNORE INTO sync_applied (event_id,device,applied_at) VALUES (?,?,?)')
    .run(ev.id, ev.device, now);
  return ev.type;
}
