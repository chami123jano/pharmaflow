/**
 * SKUs — the shop's own short code for a product.
 *
 * Lives on its own because two places need it: adding a product at the till,
 * and accepting one that arrives from another device or the website. The
 * products module already imports from the sync code, so the sync code cannot
 * import back from it without a loop.
 */
import { getDb } from './index.js';

// Build a simple SKU base from product name and optional category
export function buildSkuBase(name?: string, category?: string): string {
  const safe = (s?: string) => (s || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').trim();
  const parts: string[] = [];
  const cat = safe(category);
  if (cat) {
    // take up to first 3 letters of category words combined
    const cw = cat.split(/\s+/).map(w => w.replace(/[^A-Z0-9]/g, ''));
    const cbase = (cw[0] || '').slice(0, 3);
    if (cbase) parts.push(cbase);
  }
  const nm = safe(name);
  const words = nm.split(/\s+/).filter(Boolean);
  if (words.length) {
    // prefer letters from first 2 words, 3+2 letters
    const w1 = (words[0] || '').replace(/[^A-Z0-9]/g, '');
    const w2 = (words[1] || '').replace(/[^A-Z0-9]/g, '');
    let base = (w1.slice(0, 3) + (w2 ? w2.slice(0, 2) : '')).replace(/[^A-Z0-9]/g, '');
    if (!base) base = (w1 || 'PRD').slice(0, 3);
    parts.push(base);
    // If numeric token exists in name (e.g., 500MG), append its digits truncated
    const num = (nm.match(/\d+/g) || [])[0];
    if (num) parts.push(num.slice(0, 3));
  }
  const base = parts.filter(Boolean).join('-') || 'PRD';
  return base.slice(0, 12); // keep base reasonably short
}

// Generate a unique SKU with an incremental suffix if needed
export function generateUniqueSku(name?: string, category?: string): string {
  const db = getDb();
  const base = buildSkuBase(name, category);
  // Determine prefix from settings, default to 'LK-'
  let prefix = 'LK-';
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('sku_prefix') as any;
    const v = (row?.value ?? '').toString().trim();
    if (v) prefix = v;
  } catch {}
  // Normalize prefix: uppercase, ensure ends with '-'
  prefix = prefix.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (prefix && !prefix.endsWith('-')) prefix = prefix + '-';
  const baseFull = `${prefix}${base}`;
  // Try plain prefixed base if not taken
  const exists = db.prepare('SELECT 1 FROM products WHERE sku = ?').get(baseFull) as any;
  if (!exists) return baseFull;
  // Find existing suffixes for this base pattern
  const like = `${baseFull}-%`;
  const rows = db.prepare('SELECT sku FROM products WHERE sku LIKE ?').all(like) as Array<{ sku: string }>;
  let maxN = 0;
  for (const r of rows) {
    const m = r.sku.match(new RegExp('^' + baseFull.replace(/[-/\\^$*+?.()|[\]{}]/g, r => `\\${r}`) + '-(\\d+)$'));
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  // Propose next
  const next = maxN + 1;
  const sku = `${baseFull}-${String(next).padStart(3, '0')}`;
  return sku;
}

/**
 * The SKU to store for a product arriving from elsewhere.
 *
 * The incoming code is kept whenever it can be. It is replaced only when it is
 * blank — the website's SKU box is optional and sends nothing — or when this
 * till already uses it for a different product. Storing it as sent would break
 * the database's rule that every product has a SKU and no two share one, and
 * the whole product would be refused: added on the phone, shown on the website,
 * and silently never arriving at the till.
 *
 * On an update, keeping the till's existing code beats inventing a new one, so
 * an edit from the website never changes a product's SKU by accident.
 */
export function skuForIncoming(
  productId: string,
  incoming: unknown,
  name?: string,
  category?: string,
  existingSku?: string | null,
): string {
  const db = getDb();
  const wanted = typeof incoming === 'string' ? incoming.trim().toUpperCase() : '';

  if (wanted) {
    const owner = db.prepare('SELECT id FROM products WHERE sku = ?').get(wanted) as any;
    if (!owner || owner.id === productId) return wanted;
  }
  if (existingSku && String(existingSku).trim()) return String(existingSku);
  return generateUniqueSku(name, category);
}
