import type { Shop } from './shop';
import { markSVG, esc } from './receipt';

/**
 * The two other things the till prints on the roll: a refund slip for a
 * return, and the end-of-day cash-up. Same 72mm width and black-only rules as
 * the receipt, so they print cleanly on the same printer.
 */

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (s: any) => {
  const d = new Date(s || Date.now());
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + '  '
    + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

function page(shop: Shop, title: string, body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: 72mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: 72mm; padding: 4mm 3mm 6mm; color: #000; font-family: "Segoe UI", system-ui, sans-serif;
         font-size: 10.5pt; line-height: 1.35; font-variant-numeric: tabular-nums; }
  .c { text-align: center; } .mark { line-height: 0; margin-bottom: 1.5mm; }
  .shop { font-size: 14pt; font-weight: 800; } .ttl { font-size: 11pt; font-weight: 800; letter-spacing: .08em; margin-top: 1.5mm; }
  .rule { border-top: 1px dashed #000; margin: 2.5mm 0; }
  .kv { display: flex; justify-content: space-between; gap: 3mm; }
  .kv span:last-child { text-align: right; white-space: nowrap; }
  .it { margin: 1.2mm 0; } .nm { font-weight: 600; } .sm { font-size: 8.5pt; }
  .big { font-size: 13pt; font-weight: 800; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 1.5mm 0; margin: 2mm 0; }
  .sign { margin-top: 9mm; border-top: 1px solid #000; padding-top: 1mm; font-size: 8.5pt; }
  </style></head><body>
  <div class="c"><div class="mark">${markSVG(shop.mark)}</div><div class="shop">${esc(shop.name)}</div>
  ${shop.phone ? `<div class="sm">Tel: ${esc(shop.phone)}</div>` : ''}<div class="ttl">${esc(title)}</div></div>
  <div class="rule"></div>${body}</body></html>`;
}

export function returnSlipHTML(r: any, shop: Shop): string {
  const items = (r.items || []).map((i: any) => `
    <div class="it"><div class="nm">${esc(i.product_name || 'Item')}</div>
    <div class="kv"><span class="sm">${Number(i.qty)} returned${i.restocked ? '' : ' (not restocked)'}</span><span>${money(i.refund)}</span></div></div>`).join('');
  return page(shop, 'REFUND', `
    <div class="kv"><span>Return</span><span>#${String(r.return_no ?? '').padStart(4, '0')}</span></div>
    <div class="kv"><span>For bill</span><span>#${String(r.receipt_no ?? r.sale?.receipt_no ?? '').padStart(5, '0')}</span></div>
    <div class="kv"><span>Date</span><span>${esc(when(r.created_at))}</span></div>
    <div class="rule"></div>${items}
    <div class="kv big"><span>REFUNDED</span><span>Rs. ${money(r.refund_total)}</span></div>
    <div class="kv"><span>Paid back by</span><span>${r.method === 'card' ? 'Card' : 'Cash'}</span></div>
    ${r.reason ? `<div class="sm" style="margin-top:1.5mm">Reason: ${esc(r.reason)}</div>` : ''}
    ${r.approved_by ? `<div class="sm">Approved by ${esc(r.approved_by)}</div>` : ''}
    <div class="sign">Customer signature</div>`);
}

export function cashUpHTML(c: any, shop: Shop): string {
  const diff = Number(c.difference || 0);
  const verdict = Math.abs(diff) < 0.005 ? 'BALANCED' : diff > 0 ? `OVER Rs. ${money(diff)}` : `SHORT Rs. ${money(-diff)}`;
  let notes = '';
  try {
    const d = typeof c.denominations === 'string' ? JSON.parse(c.denominations) : c.denominations;
    if (d && typeof d === 'object') {
      notes = Object.entries(d).filter(([, n]) => Number(n) > 0)
        .map(([k, n]) => `<div class="kv sm"><span>${k === 'coins' ? 'Coins' : 'Rs. ' + k + ' × ' + n}</span><span>${money(k === 'coins' ? Number(n) : Number(k) * Number(n))}</span></div>`).join('');
    }
  } catch {}
  return page(shop, 'CASH-UP', `
    <div class="kv sm"><span>From</span><span>${esc(when(c.period_start))}</span></div>
    <div class="kv sm"><span>To</span><span>${esc(when(c.period_end))}</span></div>
    <div class="kv sm"><span>Counted by</span><span>${esc(c.created_by_name || '—')}</span></div>
    <div class="rule"></div>
    <div class="kv"><span>Bills</span><span>${Number(c.sales_count || 0)}</span></div>
    <div class="kv"><span>Cash sales</span><span>${money(c.cash_sales)}</span></div>
    <div class="kv"><span>Card sales</span><span>${money(c.card_sales)}</span></div>
    <div class="kv"><span>Cash refunds</span><span>-${money(c.cash_refunds)}</span></div>
    ${Number(c.card_refunds) ? `<div class="kv"><span>Card refunds</span><span>-${money(c.card_refunds)}</span></div>` : ''}
    <div class="rule"></div>
    <div class="kv"><span>Float</span><span>${money(c.float_amount)}</span></div>
    <div class="kv"><span>Expected in drawer</span><span>${money(c.expected_cash)}</span></div>
    <div class="kv"><span>Counted</span><span>${money(c.counted_cash)}</span></div>
    ${notes ? `<div class="rule"></div>${notes}` : ''}
    <div class="kv big"><span>${esc(verdict)}</span><span></span></div>
    ${c.notes ? `<div class="sm">Note: ${esc(c.notes)}</div>` : ''}
    <div class="sign">Signature</div>`);
}
