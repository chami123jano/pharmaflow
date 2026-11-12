/**
 * Cloud mirror over Supabase.
 *
 * Same job as the GitHub transport — carry the change log between machines —
 * but with one addition: it also pushes readable rows (products, sales,
 * batches) so the website can query them directly and stay useful while the
 * shop PC is switched off. That is the whole reason for choosing a database
 * over a repository of files.
 *
 * Plain PostgREST over fetch; no SDK, so nothing new to install or keep
 * updated in the main process.
 */
import log from '../log.js';

export interface CloudConfig {
  url: string;        // https://<project>.supabase.co
  serviceKey: string; // service_role — desktop only, never the website
}

/** Accepts the project URL in any of the forms the dashboard shows. */
export function parseProjectUrl(input: string): string | null {
  const s = (input || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  if (/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(s)) return s;
  // Bare project ref, e.g. "abcdefghijklm"
  if (/^[a-z0-9]{16,}$/i.test(s)) return `https://${s}.supabase.co`;
  const m = s.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in)/i);
  if (m) return `https://${m[1]}.supabase.${m[2]}`;
  return null;
}

function headers(cfg: CloudConfig, extra: Record<string, string> = {}) {
  return {
    apikey: cfg.serviceKey,
    Authorization: 'Bearer ' + cfg.serviceKey,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest(cfg: CloudConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(cfg.url + '/rest/v1' + path, {
    ...init,
    headers: { ...headers(cfg), ...((init.headers as any) || {}) },
  });
}

/** Confirms the keys work and the schema has been created. */
export async function checkAccess(cfg: CloudConfig): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const res = await rest(cfg, '/sync_events?select=id&limit=1');
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'BAD_KEY', message: 'The key was rejected. Check you copied the service_role key.' };
    }
    if (res.status === 404) {
      return { ok: false, error: 'NO_SCHEMA', message: 'Tables not found — run supabase/schema.sql in the SQL editor first.' };
    }
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: 'HTTP_' + res.status, message: body.slice(0, 200) };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: 'NETWORK', message: 'Could not reach Supabase: ' + (err?.message || 'no connection') };
  }
}

/** Records this device so the website can show which tills are reporting in. */
export async function announceDevice(cfg: CloudConfig, deviceId: string, label: string): Promise<void> {
  try {
    await rest(cfg, '/devices?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ id: deviceId, label, last_seen_at: new Date().toISOString() }]),
    });
  } catch { /* cosmetic only */ }
}

/** Appends this device's new events to the shared log. */
export async function pushEvents(cfg: CloudConfig, deviceId: string, events: any[]): Promise<number> {
  if (!events.length) return 0;
  const rows = events.map((e) => ({
    id: e.id,
    device_id: deviceId,
    type: e.type,
    payload: e.payload,
    ts: e.ts,
  }));
  const res = await rest(cfg, '/sync_events?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error('push failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  log.info('[cloud] pushed', rows.length, 'events');
  return rows.length;
}

/**
 * Reads everything other devices have logged since the cursor.
 *
 * The cursor is a timestamp rather than a page number so a row arriving late
 * is not skipped; applying twice is harmless because the local ledger dedupes
 * by event id.
 */
export async function pullEvents(cfg: CloudConfig, ownDeviceId: string, since?: string): Promise<any[]> {
  const parts = [
    'select=id,device_id,type,payload,ts',
    `device_id=neq.${encodeURIComponent(ownDeviceId)}`,
    'order=ts.asc',
    'limit=1000',
  ];
  if (since) parts.push(`ts=gt.${encodeURIComponent(since)}`);
  const res = await rest(cfg, '/sync_events?' + parts.join('&'));
  if (!res.ok) throw new Error('pull failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const rows = (await res.json()) as any[];
  return rows.map((r) => ({ id: r.id, device: r.device_id, type: r.type, ts: r.ts, payload: r.payload }));
}

async function upsert(cfg: CloudConfig, table: string, rows: any[], conflict = 'id'): Promise<void> {
  if (!rows.length) return;
  // Chunked so one busy day does not become a single enormous request.
  const SIZE = 500;
  for (let i = 0; i < rows.length; i += SIZE) {
    const chunk = rows.slice(i, i + SIZE);
    const res = await rest(cfg, `/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`${table} upsert failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

export interface Snapshot {
  shop?: any;
  products: any[];
  batches: any[];
  sales: any[];
  saleItems: any[];
  customers: any[];
  suppliers: any[];
  extras?: { grns: any[]; grnItems: any[]; returns: any[]; returnItems: any[]; cashUps: any[]; bills: any[]; billPayments: any[] };
}

/** Drops the given keys from every row — for a cloud table not yet given the new columns. */
const without = (rows: any[], keys: string[]) => rows.map((r) => {
  const o = { ...r }; for (const k of keys) delete o[k]; return o;
});

/**
 * Pushes readable rows for the website.
 *
 * Products must land before batches and sales before their items, or the
 * foreign keys reject them.
 */
export async function pushSnapshot(cfg: CloudConfig, snap: Snapshot): Promise<void> {
  /**
   * The shop's own details first — it is what the website's login screen shows
   * before anything else has loaded.
   *
   * Tolerated if the table is missing. This one arrived after the schema was
   * first run, so a shop that has not re-run the SQL yet would otherwise have
   * every sync fail over a cosmetic row. Sales and stock matter; a logo does
   * not.
   */
  if (snap.shop) {
    try {
      try { await upsert(cfg, 'shop', [snap.shop]); }
      catch {
        // Older cloud table without the categories column: send the rest.
        const { categories, ...rest } = snap.shop;
        await upsert(cfg, 'shop', [rest]);
      }
    } catch (err: any) {
      log.warn('[cloud] shop details not mirrored:', err?.message || err,
               '- run the latest supabase/schema.sql to enable it');
    }
  }
  await upsert(cfg, 'products', snap.products);
  await upsert(cfg, 'product_batches', snap.batches);
  await upsert(cfg, 'customers', snap.customers);
  await upsert(cfg, 'suppliers', snap.suppliers);
  /**
   * Sales carry `refunded` and lines carry `unit_cost` — columns added after
   * the cloud tables were first made. Until the owner runs the add-on SQL,
   * Supabase refuses rows with unknown columns, so retry without them rather
   * than let the whole sync fail over the newer figures.
   */
  try { await upsert(cfg, 'sales', snap.sales); }
  catch (err: any) {
    log.warn('[cloud] sales without refunds column:', err?.message || err);
    await upsert(cfg, 'sales', without(snap.sales, ['refunded']));
  }
  try { await upsert(cfg, 'sale_items', snap.saleItems); }
  catch (err: any) {
    log.warn('[cloud] sale lines without cost column:', err?.message || err);
    await upsert(cfg, 'sale_items', without(snap.saleItems, ['unit_cost']));
  }

  // Deliveries, returns and cash-ups for the owner's pages. Optional in the
  // same way as the shop row: missing tables are reported, never fatal.
  if (snap.extras) {
    const parts: Array<[string, any[]]> = [
      ['grns', snap.extras.grns], ['grn_items', snap.extras.grnItems],
      ['sale_returns', snap.extras.returns], ['sale_return_items', snap.extras.returnItems],
      ['cash_ups', snap.extras.cashUps],
      ['supplier_bills', snap.extras.bills], ['supplier_payments', snap.extras.billPayments],
    ];
    for (const [table, rows] of parts) {
      if (!rows.length) continue;
      try { await upsert(cfg, table, rows); }
      catch (err: any) {
        log.warn(`[cloud] ${table} not mirrored:`, err?.message || err, '- run supabase/add-owner-pages.sql to enable it');
        break; // later tables depend on earlier ones; no point trying the rest
      }
    }
  }
  log.info('[cloud] snapshot pushed', {
    products: snap.products.length,
    sales: snap.sales.length,
    batches: snap.batches.length,
  });
}
