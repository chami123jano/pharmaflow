import type { Shop } from './shop';

/**
 * The printed bill.
 *
 * This renders through Chromium rather than as raw printer text, so it can use
 * real type and spacing instead of padded columns. Figures still sit in a
 * monospaced column with tabular figures, because a customer checking a bill
 * reads down the right-hand edge and misaligned digits make that impossible.
 *
 * Sized for a 76mm roll (the usual Sri Lankan counter printer), which leaves
 * about 72mm printable. Nothing here is in colour and nothing relies on a
 * background tint: a thermal head only knows black, and an impact printer
 * barely manages grey.
 */

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface ReceiptOptions {
  /** Printable width in millimetres. */
  widthMm?: number;
  /** Marks a copy so it cannot be passed off as the original. */
  reprint?: boolean;
}

export function receiptHTML(sale: any, shop: Shop, opts: ReceiptOptions = {}): string {
  const width = opts.widthMm ?? 72;

  // Plain numbers down the amount column and "Rs." only on the total. Repeating
  // the currency on every line eats width a 72mm roll does not have, and a
  // customer reading a bill already knows what the numbers are in.
  const money = (n: any) =>
    Number(n ?? 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rupees = (n: any) => 'Rs. ' + money(n);
  const items: any[] = Array.isArray(sale?.items) ? sale.items : [];

  const when = new Date(sale?.createdAt || Date.now());
  const stamp =
    when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    '  ' + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const pay = String(sale?.payment || '').toUpperCase();
  const discount = Number(sale?.discountAmount ?? 0);
  const receiptNo = String(sale?.receiptNo ?? '').padStart(5, '0');

  const rows = items.map((it) => {
    const name = String(it?.product?.name ?? 'Item').trim();
    const generic = String(it?.product?.generic_name ?? '').trim();
    const qty = Number(it?.qty || 0);
    const unit = Number(it?.unitPrice ?? 0);
    return `
      <tr class="item">
        <td colspan="2" class="nm">${esc(name)}${generic && generic.toLowerCase() !== name.toLowerCase()
          ? `<span class="gen">${esc(generic)}</span>` : ''}</td>
      </tr>
      <tr class="item">
        <td class="qty">${qty} &times; ${esc(money(unit))}</td>
        <td class="amt">${esc(money(qty * unit))}</td>
      </tr>`;
  }).join('');

  const line = (label: string, value: string, cls = '') =>
    `<tr class="${cls}"><td class="lbl">${esc(label)}</td><td class="amt">${esc(value)}</td></tr>`;

  const head = [
    shop.address && `<div class="sub">${esc(shop.address)}</div>`,
    shop.phone && `<div class="sub">Tel: ${esc(shop.phone)}</div>`,
    shop.regno && `<div class="sub">Reg. ${esc(shop.regno)}</div>`,
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { size: ${width}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: ${width}mm;
    padding: 4mm 3mm 6mm;
    color: #000;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: 10.5pt;
    line-height: 1.35;
    /* Digits must share a width or the right-hand column will not line up. */
    font-variant-numeric: tabular-nums;
    -webkit-print-color-adjust: exact;
  }
  .shop { text-align: center; font-size: 15pt; font-weight: 800; letter-spacing: -0.2px; }
  .sub  { text-align: center; font-size: 8.5pt; }
  .rule { border-top: 1px solid #000; margin: 2.5mm 0; }
  .dots { border-top: 1px dashed #000; margin: 2.5mm 0; }
  .meta { display: flex; justify-content: space-between; font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0; vertical-align: top; }
  .nm   { font-weight: 600; padding-top: 1.6mm; }
  .gen  { display: block; font-weight: 400; font-size: 8pt; }
  .qty  { font-size: 9pt; padding-left: 2mm; }
  .amt  { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .lbl  { font-size: 9.5pt; }
  .hdr td { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.4px;
            border-bottom: 1px solid #000; padding-bottom: 0.8mm; }
  .tot td { font-size: 13pt; font-weight: 800; padding: 1.5mm 0; }
  .totbox { border-top: 2px solid #000; border-bottom: 2px solid #000; margin: 1.5mm 0; }
  .foot { text-align: center; font-size: 9pt; margin-top: 3mm; }
  .fine { text-align: center; font-size: 7.5pt; margin-top: 1.5mm; }
  .copy { text-align: center; font-size: 9pt; font-weight: 700; border: 1px solid #000;
          padding: 0.8mm; margin-bottom: 2mm; }
</style></head>
<body>
  ${opts.reprint ? '<div class="copy">REPRINT &mdash; NOT AN ORIGINAL</div>' : ''}

  <div class="shop">${esc(shop.name)}</div>
  ${head}

  <div class="rule"></div>
  <div class="meta"><span>Bill #${esc(receiptNo)}</span><span>${esc(stamp)}</span></div>
  ${sale?.cashierName ? `<div class="meta"><span>Served by ${esc(sale.cashierName)}</span><span></span></div>` : ''}
  <div class="dots"></div>

  <table>
    <tr class="hdr"><td>Item</td><td class="amt">Amount (Rs.)</td></tr>
    ${rows}
  </table>

  <div class="dots"></div>
  <table>
    ${line('Subtotal', money(sale?.subtotal))}
    ${discount > 0 ? line('Discount', '- ' + money(discount)) : ''}
    ${sale?.approvedBy ? line('Approved by', String(sale.approvedBy)) : ''}
  </table>

  <div class="totbox">
    <table><tr class="tot"><td>TOTAL</td><td class="amt">${esc(rupees(sale?.total))}</td></tr></table>
  </div>

  <table>
    ${line('Paid by', pay || '-')}
    ${pay === 'CASH' && Number(sale?.customerAmount) > 0
      ? line('Cash given', money(sale.customerAmount)) + line('Change', money(sale.change))
      : ''}
  </table>

  <div class="dots"></div>
  <div class="foot">${esc(shop.footer)}</div>
  <div class="fine">Please keep this bill. Medicines are not returnable once sold.</div>
</body></html>`;
}
