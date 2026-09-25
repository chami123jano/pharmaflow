/**
 * Parses rows pasted from a spreadsheet into product records.
 *
 * Entering stock one product at a time is the slowest part of setting the
 * system up, and it is normally done from an existing supplier list. Pasting
 * that list straight in removes the retyping.
 *
 * Accepts tab-separated (what Excel and Google Sheets put on the clipboard)
 * or comma-separated text. A header row is detected and used to map columns;
 * without one, columns fall back to positional order.
 */

export interface ImportRow {
  line: number;
  name: string;
  generic_name: string;
  price: number;
  stock: number;
  category: string;
  supplier: string;
  barcode: string;
  expiry: string;
  errors: string[];
  duplicate?: boolean;
}

export const IMPORT_COLUMNS = ['name', 'generic_name', 'price', 'stock', 'category', 'supplier', 'barcode', 'expiry'] as const;

/** Header spellings a pharmacist might reasonably use. */
const HEADER_ALIASES: Record<string, string> = {
  name: 'name', product: 'name', 'product name': 'name', medicine: 'name', brand: 'name', 'brand name': 'name', item: 'name',
  generic: 'generic_name', generic_name: 'generic_name', 'generic name': 'generic_name', ingredient: 'generic_name', molecule: 'generic_name',
  price: 'price', mrp: 'price', 'unit price': 'price', 'selling price': 'price', rate: 'price',
  stock: 'stock', qty: 'stock', quantity: 'stock', 'in stock': 'stock', units: 'stock',
  category: 'category', type: 'category', group: 'category',
  supplier: 'supplier', vendor: 'supplier', distributor: 'supplier',
  barcode: 'barcode', ean: 'barcode', upc: 'barcode', code: 'barcode',
  expiry: 'expiry', expiry_date: 'expiry', 'expiry date': 'expiry', exp: 'expiry', 'best before': 'expiry',
};

/** Splits one line, honouring double quotes so a quoted comma is not a break. */
export function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Tabs win when present — that is what a spreadsheet paste looks like. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  if (firstLine.includes('\t')) return '\t';
  if (firstLine.includes(',')) return ',';
  if (firstLine.includes(';')) return ';';
  return '\t';
}

function isHeaderRow(cells: string[]): boolean {
  const known = cells.filter((c) => HEADER_ALIASES[c.toLowerCase().trim()]).length;
  return known >= 2;
}

/**
 * Accepts "1,250.50" and "Rs. 90" as well as plain numbers.
 *
 * Matches the numeric token rather than stripping unwanted characters: the
 * full stop in a "Rs." prefix would otherwise survive and turn the value into
 * ".1250.50", which is NaN.
 */
export function parseNumber(raw: string): number | null {
  if (raw == null) return null;
  const m = String(raw).match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export interface ParseResult {
  rows: ImportRow[];
  headerDetected: boolean;
  columns: string[];
}

export function parseBulk(text: string, existing: Array<{ name?: string; barcode?: string | null }> = []): ParseResult {
  const delim = detectDelimiter(text);
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!rawLines.length) return { rows: [], headerDetected: false, columns: [] };

  let columns: string[] = [...IMPORT_COLUMNS];
  let headerDetected = false;
  let startIdx = 0;

  const firstCells = splitLine(rawLines[0], delim);
  if (isHeaderRow(firstCells)) {
    headerDetected = true;
    startIdx = 1;
    columns = firstCells.map((c) => HEADER_ALIASES[c.toLowerCase().trim()] || '');
  }

  const existingNames = new Set(existing.map((p) => (p.name || '').toLowerCase().trim()).filter(Boolean));
  const existingCodes = new Set(existing.map((p) => (p.barcode || '').toLowerCase().trim()).filter(Boolean));
  const seenNames = new Set<string>();

  const rows: ImportRow[] = [];
  for (let i = startIdx; i < rawLines.length; i++) {
    const cells = splitLine(rawLines[i], delim);
    const get = (field: string) => {
      const idx = columns.indexOf(field);
      return idx >= 0 && idx < cells.length ? cells[idx] : '';
    };

    const name = get('name');
    const priceRaw = get('price');
    const stockRaw = get('stock');
    const price = parseNumber(priceRaw);
    const stock = parseNumber(stockRaw);
    const barcode = get('barcode');

    const errors: string[] = [];
    if (!name) errors.push('name is required');
    if (priceRaw && price === null) errors.push(`price "${priceRaw}" is not a number`);
    if (price !== null && price < 0) errors.push('price cannot be negative');
    if (stockRaw && stock === null) errors.push(`stock "${stockRaw}" is not a number`);
    if (stock !== null && stock < 0) errors.push('stock cannot be negative');

    const key = name.toLowerCase().trim();
    let duplicate = false;
    if (key && existingNames.has(key)) { duplicate = true; errors.push('already in inventory'); }
    else if (key && seenNames.has(key)) { duplicate = true; errors.push('repeated in this paste'); }
    else if (barcode && existingCodes.has(barcode.toLowerCase())) { duplicate = true; errors.push('barcode already used'); }
    if (key) seenNames.add(key);

    rows.push({
      line: i + 1,
      name,
      generic_name: get('generic_name'),
      price: price ?? 0,
      stock: stock ?? 0,
      category: get('category'),
      supplier: get('supplier'),
      barcode,
      expiry: get('expiry'),
      errors,
      duplicate,
    });
  }

  return { rows, headerDetected, columns };
}

export const EXAMPLE_PASTE = `name\tgeneric\tprice\tstock\tcategory\tbarcode
Panadol 500mg\tParacetamol\t15.00\t240\tAnalgesic\t8901001
Amoxil 250mg\tAmoxicillin\t48.50\t80\tAntibiotic\t8901003`;
