import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';
import crypto from 'crypto';
import log from '../log.js';
import { openWasmDb } from './sqlite-wasm.js';
import { hashPassword } from '../auth/password.js';

let db: any | null = null;

export async function initDb() {
  if (db) return;
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(userData, 'pharmaflow.db');
  try {
    const restorePath = path.join(userData, 'pharmaflow.db.restore');
    if (fs.existsSync(restorePath)) {
      const ts = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
      const bakPath = path.join(userData, `pharmaflow.db.bak-${stamp}`);
      if (fs.existsSync(dbPath)) { try { fs.copyFileSync(dbPath, bakPath); } catch {} }
      try { fs.copyFileSync(restorePath, dbPath); fs.unlinkSync(restorePath); } catch (e) { log.error('[DB] Failed staged restore', e); }
    }
  } catch {}
  db = await openWasmDb(dbPath);
  try { if (typeof db.pragma === 'function') db.pragma('foreign_keys = ON'); } catch {}
  log.info('[DB] Initialized at', dbPath);
  await ensureSchema();
}

function ensureTable(d: any, name: string, sql: string) {
  if (!d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)) d.prepare(sql).run();
}
function ensureColumn(d: any, table: string, col: string, def: string) {
  try {
    const cols = d.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
    if (!cols.find(c => c.name === col)) d.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run();
  } catch {}
}

export async function ensureSchema() {
  const d = getDb();
  ensureTable(d, 'users', `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'clerk', name TEXT, created_at TEXT NOT NULL)`);
  ensureColumn(d, 'users', 'name', 'TEXT');
  d.prepare('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)').run();

  ensureTable(d, 'products', `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT UNIQUE NOT NULL, price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0, expiry TEXT, description TEXT, supplier TEXT,
    category TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  ensureColumn(d, 'products', 'description', 'TEXT');
  ensureColumn(d, 'products', 'supplier', 'TEXT');
  ensureColumn(d, 'products', 'category', 'TEXT');
  // Active ingredient, so typing "paracetamol" at the counter finds Panadol.
  ensureColumn(d, 'products', 'generic_name', 'TEXT');
  // Scanned barcode, kept separate from the internally generated SKU.
  ensureColumn(d, 'products', 'barcode', 'TEXT');
  d.prepare('CREATE INDEX IF NOT EXISTS idx_products_sku      ON products(sku)').run();
  d.prepare('CREATE INDEX IF NOT EXISTS idx_products_name     ON products(name)').run();
  d.prepare('CREATE INDEX IF NOT EXISTS idx_products_barcode  ON products(barcode)').run();
  d.prepare('CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)').run();
  d.prepare('CREATE INDEX IF NOT EXISTS idx_products_stock    ON products(stock)').run();

  ensureTable(d, 'sales', `CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY, receipt_no INTEGER, subtotal REAL NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent', discount_value REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
    payment_method TEXT NOT NULL, customer_amount REAL NOT NULL DEFAULT 0,
    change_amount REAL NOT NULL DEFAULT 0, cashier_id TEXT, notes TEXT, created_at TEXT NOT NULL)`);
  ensureColumn(d, 'sales', 'receipt_no',      'INTEGER');
  ensureColumn(d, 'sales', 'subtotal',        'REAL NOT NULL DEFAULT 0');
  ensureColumn(d, 'sales', 'discount_type',   "TEXT NOT NULL DEFAULT 'percent'");
  ensureColumn(d, 'sales', 'discount_value',  'REAL NOT NULL DEFAULT 0');
  ensureColumn(d, 'sales', 'discount_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(d, 'sales', 'customer_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(d, 'sales', 'change_amount',   'REAL NOT NULL DEFAULT 0');
  ensureColumn(d, 'sales', 'cashier_id',      'TEXT');
  ensureColumn(d, 'sales', 'notes',           'TEXT');
  // A voided sale is kept, not deleted — the receipt number stays used and the
  // reversal is auditable. Reports must exclude rows where voided_at IS NOT NULL.
  ensureColumn(d, 'sales', 'voided_at',       'TEXT');
  ensureColumn(d, 'sales', 'voided_by',       'TEXT');
  ensureColumn(d, 'sales', 'void_reason',     'TEXT');
  d.prepare('CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at)').run();
  d.prepare('CREATE INDEX IF NOT EXISTS idx_sales_cashier    ON sales(cashier_id)').run();

  ensureTable(d, 'sale_items', `CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL, unit_price REAL NOT NULL, line_total REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE)`);
  d.prepare('CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id    ON sale_items(sale_id)').run();
  d.prepare('CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id)').run();

  // People the shop buys from and sells to. Both are optional wherever they are
  // used — the counter must never be held up because nobody typed a name.
  ensureTable(d, 'customers', `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT,
    notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  d.prepare('CREATE INDEX IF NOT EXISTS idx_customers_name  ON customers(name)').run();
  d.prepare('CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)').run();

  ensureTable(d, 'suppliers', `CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT,
    contact_person TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  d.prepare('CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name)').run();

  // A sale may name a customer; a batch may name the supplier it came from.
  ensureColumn(d, 'sales', 'customer_id', 'TEXT');
  ensureColumn(d, 'product_batches', 'supplier_id', 'TEXT');

  // One row per delivery. A product's stock is the sum of its batches, so the
  // same medicine can sit on the shelf under several expiry dates at once.
  ensureTable(d, 'product_batches', `CREATE TABLE IF NOT EXISTS product_batches (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, batch_no TEXT, expiry TEXT,
    qty_received INTEGER NOT NULL DEFAULT 0, qty_remaining INTEGER NOT NULL DEFAULT 0,
    cost_price REAL, supplier TEXT, notes TEXT, created_by TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE)`);
  d.prepare('CREATE INDEX IF NOT EXISTS idx_batches_product ON product_batches(product_id)').run();
  // Allocation reads batches in expiry order, so that is the index that matters.
  d.prepare('CREATE INDEX IF NOT EXISTS idx_batches_expiry  ON product_batches(expiry)').run();

  // Which batch each sold line came out of, for recalls and for putting the
  // right quantity back when a sale is voided.
  ensureColumn(d, 'sale_items', 'batch_id', 'TEXT');

  ensureTable(d, 'settings', `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  ensureTable(d, 'receipt_seq', `CREATE TABLE IF NOT EXISTS receipt_seq (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL)`);
  ensureTable(d, 'stock_movements', `CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, type TEXT NOT NULL, quantity INTEGER NOT NULL,
    reference TEXT, notes TEXT, created_by TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE)`);
  d.prepare('CREATE INDEX IF NOT EXISTS idx_stock_mov_product ON stock_movements(product_id)').run();
  d.prepare('CREATE INDEX IF NOT EXISTS idx_stock_mov_created ON stock_movements(created_at)').run();

  // Parked bills. When a customer goes back for another item, the counter
  // holds the bill and serves the next person instead of blocking the queue.
  // Stock is NOT reserved while a bill is held — it is deducted at sale time,
  // so a held bill can fail on recall if the last unit was sold meanwhile.
  ensureTable(d, 'held_sales', `CREATE TABLE IF NOT EXISTS held_sales (
    id TEXT PRIMARY KEY, label TEXT, payload TEXT NOT NULL,
    item_count INTEGER NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
    created_by TEXT, created_at TEXT NOT NULL)`);
  d.prepare('CREATE INDEX IF NOT EXISTS idx_held_created ON held_sales(created_at)').run();

  // Outbox of changes this device made, and the ledger of changes from other
  // devices that have already been applied. See src/main/sync/events.ts.
  ensureTable(d, 'sync_events', `CREATE TABLE IF NOT EXISTS sync_events (
    id TEXT PRIMARY KEY, device TEXT NOT NULL, type TEXT NOT NULL, ts TEXT NOT NULL,
    payload TEXT NOT NULL, pushed INTEGER NOT NULL DEFAULT 0)`);
  d.prepare('CREATE INDEX IF NOT EXISTS idx_sync_events_pushed ON sync_events(pushed)').run();
  ensureTable(d, 'sync_applied', `CREATE TABLE IF NOT EXISTS sync_applied (
    event_id TEXT PRIMARY KEY, device TEXT, applied_at TEXT NOT NULL)`);

  const existing = d.prepare('SELECT id FROM users WHERE email = ?').get('admin@local');
  if (!existing) {
    const hash = await hashPassword('admin123');
    d.prepare('INSERT INTO users (id,email,password_hash,role,name,created_at) VALUES (?,?,?,?,?,?)')
      .run(crypto.randomUUID(), 'admin@local', hash, 'admin', 'Admin', new Date().toISOString());
  }
  const defaults: [string, string][] = [
    // The shop's identity is data, not code. The default is the product's own
    // name, so a fresh copy of this software runs as PharmaFlow; a real shop
    // types its own details in Settings and the whole app follows.
    ['pharmacy.name','PharmaFlow'],['pharmacy.address',''],['pharmacy.phone',''],
    ['pharmacy.regno',''],['pharmacy.footer','Thank you. Get well soon.'],
    ['sku_prefix','LK-'],['printer.receipt.name',''],
    // Receipts print without a dialog by default. A dialog left open is a
    // native modal that blocks the main process, which has previously stopped
    // a sale from finishing and left the app unable to restart.
    ['printer.receipt.silent','1'],
    ['sale.max_discount','100'],['server.url',''],['server.mode','local'],
    // A discount above this percentage needs an admin password at the counter.
    ['sale.discount_approval_percent','5'],
    // Blank means Documents/PharmaFlow/Receipts.
    ['receipts.folder',''],
    // Staff lockdown, off unless the shop turns it on. Defaulting these on
    // would lock whoever installs the app into a till they did not ask for.
    ['security.lock_exit','0'],
    ['security.kiosk','0'],
  ];
  for (const [k, v] of defaults) try { d.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(k, v); } catch {}

  // Existing stock predates batches. Move it into a single opening batch so
  // nothing is lost and allocation has something to draw from. Runs once.
  try {
    const done = d.prepare("SELECT value FROM settings WHERE key = 'batches.migrated'").get() as any;
    if (String(done?.value) !== '1') {
      const rows = d.prepare('SELECT id, stock, expiry FROM products WHERE stock > 0').all() as any[];
      let made = 0;
      for (const r of rows) {
        const has = d.prepare('SELECT 1 AS x FROM product_batches WHERE product_id = ?').get(r.id);
        if (has) continue;
        d.prepare(`INSERT INTO product_batches (id,product_id,batch_no,expiry,qty_received,qty_remaining,notes,created_at)
                   VALUES (?,?,?,?,?,?,?,?)`)
          .run(crypto.randomUUID(), r.id, 'OPENING', r.expiry || null, r.stock, r.stock,
               'Stock on hand before batch tracking', new Date().toISOString());
        made++;
      }
      d.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('batches.migrated','1')").run();
      if (made) log.info('[DB] moved existing stock into', made, 'opening batch(es)');
    }
  } catch (err: any) {
    log.error('[DB] opening-batch migration failed', err?.message || err);
  }

  // Databases created before silent printing became the default still carry
  // '0'. Only flip it where no printer was ever chosen, which means the value
  // is the old default rather than something the pharmacy actually picked.
  try {
    const sil = d.prepare("SELECT value FROM settings WHERE key = 'printer.receipt.silent'").get() as any;
    const nm = d.prepare("SELECT value FROM settings WHERE key = 'printer.receipt.name'").get() as any;
    if (String(sil?.value) === '0' && !String(nm?.value || '').trim()) {
      d.prepare("UPDATE settings SET value = '1' WHERE key = 'printer.receipt.silent'").run();
      log.info('[DB] receipts set to print without a dialog (no printer was chosen)');
    }
  } catch {}
}

export function getDb(): any { if (!db) throw new Error('DB not initialized'); return db; }
export async function ensureSeedUser() { return; }
export function closeDb() { if (db && typeof db.close === 'function') { try { db.close(); } catch {} } db = null; }
