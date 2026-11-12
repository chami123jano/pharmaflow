/**
 * A stand-in for the Supabase client, used only by the preview entry.
 *
 * The pages cannot be looked at without signing in, and a password is not
 * something to go asking for. This returns plausible rows so the screens can
 * be rendered, screenshotted and judged before anything ships.
 *
 * Deleted along with the rest of src/__preview once a design is settled.
 */

const today = new Date();
const at = (hours: number, mins = 0) => {
  const d = new Date(today);
  d.setHours(hours, mins, 0, 0);
  return d.toISOString();
};
const daysAgo = (n: number, hours = 11) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  d.setHours(hours, 30, 0, 0);
  return d.toISOString();
};

const SALES = [
  { id: 's1', receipt_no: 41, total: 1450, discount_amount: 50, subtotal: 1500, payment_method: 'cash', cashier_name: 'Admin', customer_amount: 2000, change_amount: 550, voided_at: null, created_at: at(18, 12) },
  { id: 's2', receipt_no: 40, total: 320, discount_amount: 0, subtotal: 320, payment_method: 'card', cashier_name: 'Nimali', customer_amount: 0, change_amount: 0, voided_at: null, created_at: at(16, 45) },
  { id: 's3', receipt_no: 39, total: 2870.5, discount_amount: 129.5, subtotal: 3000, payment_method: 'cash', cashier_name: 'Admin', customer_amount: 3000, change_amount: 129.5, voided_at: null, created_at: at(14, 3) },
  { id: 's4', receipt_no: 38, total: 180, discount_amount: 0, subtotal: 180, payment_method: 'cash', cashier_name: 'Nimali', customer_amount: 200, change_amount: 20, voided_at: at(13, 10), created_at: at(12, 58) },
  { id: 's5', receipt_no: 37, total: 940, discount_amount: 0, subtotal: 940, payment_method: 'cash', cashier_name: 'Admin', customer_amount: 1000, change_amount: 60, voided_at: null, created_at: at(10, 22) },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({
    id: 'h' + n, receipt_no: 36 - n, total: [3200, 4100, 2750, 5600, 1900, 4400][n - 1],
    discount_amount: 0, subtotal: 0, payment_method: n % 3 ? 'cash' : 'card',
    cashier_name: 'Admin', customer_amount: 0, change_amount: 0, voided_at: null, created_at: daysAgo(n),
  })),
];

const ITEMS = [
  { id: 'i1', sale_id: 's1', product_id: 'p1', product_name: 'Panadol 500mg', quantity: 4, unit_price: 100, line_total: 400 },
  { id: 'i2', sale_id: 's1', product_id: 'p2', product_name: 'Amoxil 250mg Capsule', quantity: 20, unit_price: 27.5, line_total: 550 },
  { id: 'i3', sale_id: 's1', product_id: 'p3', product_name: 'Piriton Syrup 60ml', quantity: 1, unit_price: 500, line_total: 500 },
  { id: 'i4', sale_id: 's2', product_id: 'p1', product_name: 'Panadol 500mg', quantity: 2, unit_price: 100, line_total: 200 },
  { id: 'i5', sale_id: 's3', product_id: 'p4', product_name: 'Augmentin 625mg', quantity: 10, unit_price: 287, line_total: 2870 },
  { id: 'i6', sale_id: 's5', product_id: 'p5', product_name: 'Vitamin C 1000mg Effervescent', quantity: 1, unit_price: 940, line_total: 940 },
];

const PRODUCTS = [
  { id: 'p1', name: 'Panadol 500mg', sku: 'LK-ANA-PAN', generic_name: 'Paracetamol', barcode: '1234', category: 'Analgesic', price: 100, stock: 95, supplier: 'Sunshine', description: '', expiry: '2027-09-30' },
  { id: 'p2', name: 'Amoxil 250mg Capsule', sku: 'LK-ABX-AMX', generic_name: 'Amoxicillin', barcode: null, category: 'Antibiotic', price: 27.5, stock: 8, supplier: 'GSK', description: '', expiry: '2026-11-15' },
  { id: 'p3', name: 'Piriton Syrup 60ml', sku: 'LK-AH-PIR', generic_name: 'Chlorpheniramine', barcode: null, category: 'Antihistamine', price: 500, stock: 0, supplier: null, description: '', expiry: null },
  { id: 'p4', name: 'Augmentin 625mg', sku: 'LK-ABX-AUG', generic_name: 'Amoxicillin + Clavulanate', barcode: null, category: 'Antibiotic', price: 287, stock: 42, supplier: 'GSK', description: '', expiry: '2026-10-12' },
  { id: 'p5', name: 'Vitamin C 1000mg Effervescent', sku: 'LK-SUP-VTC', generic_name: null, barcode: null, category: 'Supplement', price: 940, stock: 3, supplier: null, description: '', expiry: '2028-01-31' },
  { id: 'p6', name: 'Actrapid HM Insulin 100IU/ml', sku: 'LK-ACTR-100', generic_name: 'Soluble Human Insulin', barcode: null, category: 'Antidiabetic', price: 0, stock: 0, supplier: null, description: '', expiry: null },
];

const BATCHES = [
  { id: 'b1', product_id: 'p1', batch_no: 'A4471', expiry: '2026-10-05', qty_remaining: 30 },
  { id: 'b2', product_id: 'p1', batch_no: 'A5120', expiry: '2027-09-30', qty_remaining: 65 },
  { id: 'b3', product_id: 'p4', batch_no: 'G-8831', expiry: '2026-10-12', qty_remaining: 42 },
  { id: 'b4', product_id: 'p2', batch_no: 'X-22', expiry: '2026-11-15', qty_remaining: 8 },
  { id: 'b5', product_id: 'p5', batch_no: 'V-9', expiry: '2026-09-29', qty_remaining: 3 },
];

const SHOP = [{ name: 'Chamindu Pharmacy', address: 'No. 12, Main Street, Kandy', phone: '0714438410', logo: 'capsule' }];
const DEVICES = [{ last_seen_at: new Date(Date.now() - 4 * 60 * 1000).toISOString() }];

// Owner pages: costs, a return, a cash-up and two deliveries.
const COSTS: Record<string, number> = { p1: 70, p2: 18, p3: 380 };
const ITEMS_C = ITEMS.map((i: any) => ({ ...i, unit_cost: COSTS[i.product_id] ?? null }));
const RETURNS = [{ id: 'r1', return_no: 1, sale_id: 's1', receipt_no: 41, refund_total: 96.67, method: 'cash', reason: 'wrong strength', created_by_name: 'Admin', created_at: at(18, 40) }];
const RETURN_ITEMS = [{ id: 'ri1', return_id: 'r1', product_id: 'p1', product_name: 'Panadol 500mg', qty: 1, refund: 96.67, unit_cost: 70, restocked: true }];
const CASHUPS = [{ id: 'c1', created_at: at(21, 5), created_by_name: 'Admin', difference: -50, expected_cash: 5200, counted_cash: 5150 }];
const GRNS = [
  { id: 'g1', grn_no: 2, supplier_name: 'City Pharma Distributors', invoice_no: 'INV-20431', total_cost: 12450, line_count: 3, unit_count: 140, created_at: at(9, 30), voided_at: null },
  { id: 'g2', grn_no: 1, supplier_name: 'Hemas', invoice_no: 'H-1188', total_cost: 3600, line_count: 1, unit_count: 40, created_at: at(8, 5), voided_at: null },
];
const GRN_ITEMS = [
  { id: 'gi1', grn_id: 'g1', product_name: 'Panadol 500mg', batch_no: 'PX-22', expiry: '2028-03-31', qty: 100, free_qty: 10, cost_price: 70, line_total: 7000 },
  { id: 'gi2', grn_id: 'g1', product_name: 'Amoxil 250mg Capsule', batch_no: 'AM-7', expiry: '2027-08-31', qty: 30, free_qty: 0, cost_price: 150, line_total: 4500 },
];

const TABLES: Record<string, any[]> = {
  sale_returns: RETURNS, sale_return_items: RETURN_ITEMS, cash_ups: CASHUPS, grns: GRNS, grn_items: GRN_ITEMS,
  sales: SALES, sale_items: ITEMS_C, products: PRODUCTS,
  product_batches: BATCHES, shop: SHOP, devices: DEVICES, app_users: [{ user_id: 'u1', role: 'owner' }],
};

/** Enough of the query builder for the pages to run: every method returns this. */
function builder(table: string) {
  let rows = [...(TABLES[table] || [])];
  const self: any = {
    select: () => self,
    eq: (col: string, val: any) => { rows = rows.filter((r) => r[col] === val); return self; },
    is: (col: string, val: any) => { rows = rows.filter((r) => r[col] === val); return self; },
    gte: (col: string, val: any) => { rows = rows.filter((r) => String(r[col]) >= String(val)); return self; },
    gt: (col: string, val: any) => { rows = rows.filter((r) => Number(r[col]) > Number(val)); return self; },
    in: (col: string, vals: any[]) => { rows = rows.filter((r) => vals.includes(r[col])); return self; },
    order: (col: string, o: any) => {
      rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      if (o && o.ascending === false) rows.reverse();
      return self;
    },
    limit: (n: number) => { rows = rows.slice(0, n); return self; },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (res: any) => Promise.resolve({ data: rows, error: null }).then(res),
    upsert: () => Promise.resolve({ error: null }),
    insert: () => Promise.resolve({ error: null }),
  };
  return self;
}

export const supabase: any = {
  from: (table: string) => builder(table),
  channel: () => ({ on: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
  auth: {
    // A signed-in owner, so pages that gate on a role render their full form.
    getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1', email: 'owner@example.com' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: () => Promise.resolve({ error: null }),
    signOut: () => Promise.resolve({}),
  },
};
