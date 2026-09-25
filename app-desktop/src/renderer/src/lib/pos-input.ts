/**
 * Parsing for the single POS input box.
 *
 * The counter should never have to leave the search field. Typing "6*panadol"
 * adds six at once instead of adding one and pressing a key five more times.
 *
 * Accepted forms:
 *   panadol         -> { qty: 1, term: 'panadol' }
 *   6*panadol       -> { qty: 6, term: 'panadol' }
 *   panadol*6       -> { qty: 6, term: 'panadol' }
 *   6 x panadol     -> { qty: 6, term: 'panadol' }
 *   panadol x 6     -> { qty: 6, term: 'panadol' }
 *
 * A bare number is deliberately NOT a quantity — barcodes are digits, and
 * treating "8901234567890" as a quantity would be worse than useless. It is
 * returned as a term so the caller can look it up as a barcode or SKU.
 */

export interface ParsedEntry {
  qty: number;
  term: string;
}

/** Quantities above this are almost certainly a mistyped barcode. */
export const MAX_QTY = 9999;

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  const i = Math.floor(n);
  if (i < 1) return 1;
  if (i > MAX_QTY) return MAX_QTY;
  return i;
}

export function parseEntry(raw: string): ParsedEntry {
  const input = (raw ?? '').trim();
  if (!input) return { qty: 1, term: '' };

  // Leading quantity: "6*panadol", "6 x panadol"
  const leading = input.match(/^(\d{1,4})\s*[*x]\s*(.+)$/i);
  if (leading) {
    const term = leading[2].trim();
    if (term) return { qty: clampQty(Number(leading[1])), term };
  }

  // Trailing quantity: "panadol*6", "panadol x 6"
  const trailing = input.match(/^(.+?)\s*[*x]\s*(\d{1,4})$/i);
  if (trailing) {
    const term = trailing[1].trim();
    if (term) return { qty: clampQty(Number(trailing[2])), term };
  }

  // Anything else — including a bare number, which is treated as a code.
  return { qty: 1, term: input };
}

/**
 * Ranks products for the given term. Exact code matches come first so a
 * scanned barcode resolves immediately; after that, names that start with the
 * term beat names that merely contain it.
 */
export interface Searchable {
  name?: string;
  sku?: string;
  barcode?: string | null;
  generic_name?: string | null;
  category?: string | null;
  supplier?: string | null;
}

export function scoreProduct(p: Searchable, termLower: string): number {
  if (!termLower) return -1;

  const sku = (p.sku || '').toLowerCase();
  const barcode = (p.barcode || '').toLowerCase();
  if (barcode && barcode === termLower) return 1000;
  if (sku === termLower) return 900;

  const name = (p.name || '').toLowerCase();
  const generic = (p.generic_name || '').toLowerCase();

  if (name === termLower) return 800;
  if (name.startsWith(termLower)) return 700;
  if (generic.startsWith(termLower)) return 600;
  if (name.includes(termLower)) return 500;
  if (generic.includes(termLower)) return 400;
  if (sku.includes(termLower)) return 300;
  if ((p.category || '').toLowerCase().includes(termLower)) return 200;
  if ((p.supplier || '').toLowerCase().includes(termLower)) return 100;

  return -1;
}

export interface SearchOptions {
  /**
   * Put anything sellable above anything that is not. At the counter the first
   * entry is what Enter takes, and offering a strength that is out of stock —
   * or has no price yet — ahead of one on the shelf just wastes a keystroke.
   * Unsellable items still appear, so the cashier can see the shop carries them.
   */
  sellableFirst?: boolean;
}

function isSellable(p: any): boolean {
  return Number(p?.stock ?? 0) > 0 && Number(p?.price ?? 0) > 0;
}

export function searchProducts<T extends Searchable>(
  products: T[], term: string, limit = 8, opts: SearchOptions = {}
): T[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const scored: Array<{ p: T; s: number }> = [];
  for (const p of products) {
    const s = scoreProduct(p, t);
    if (s >= 0) scored.push({ p, s });
  }
  scored.sort((a, b) => {
    if (opts.sellableFirst) {
      const av = isSellable(a.p) ? 1 : 0;
      const bv = isSellable(b.p) ? 1 : 0;
      if (av !== bv) return bv - av;
    }
    return b.s - a.s || (a.p.name || '').localeCompare(b.p.name || '');
  });
  return scored.slice(0, limit).map((x) => x.p);
}

/**
 * Finds the single product a scan or exact code refers to, or null when the
 * input is ambiguous and should be shown as a list instead.
 */
export function findExact<T extends Searchable>(products: T[], term: string): T | null {
  const t = term.trim().toLowerCase();
  if (!t) return null;
  return (
    products.find((p) => (p.barcode || '').toLowerCase() === t) ||
    products.find((p) => (p.sku || '').toLowerCase() === t) ||
    null
  );
}

/** Cash denominations in circulation in Sri Lanka, for the quick-tender row. */
export const LKR_NOTES = [50, 100, 500, 1000, 5000];

/**
 * Suggests tender amounts for the given total: the exact amount, then the next
 * sensible round numbers a customer would actually hand over.
 */
export function tenderSuggestions(total: number, count = 4): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  const exact = Math.ceil(total);
  const out = new Set<number>([exact]);
  for (const note of LKR_NOTES) {
    const up = Math.ceil(total / note) * note;
    if (up >= total) out.add(up);
  }
  return [...out].sort((a, b) => a - b).slice(0, count);
}
