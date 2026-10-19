import type { Shop } from './shop';
import { markSVG, esc } from './receipt';

/**
 * The printed goods received note, in two sizes.
 *
 * A4 is the record: filed, attached to the supplier's invoice, or sent back to
 * them when a line is short. The roll version is for a shop whose only printer
 * is the receipt printer — the same facts, one line per item.
 *
 * Black only, for the same reason as the receipt: most of these will be
 * printed on whatever is to hand.
 */

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const grnNo = (n: any) => 'GRN-' + String(n ?? 0).padStart(4, '0');

const day = (s: any) =>
  s ? new Date(String(s).length === 10 ? s + 'T00:00:00' : s)
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const expiryText = (s: any) => (s ? String(s).slice(0, 7) : '—');

export function grnA4HTML(g: any, shop: Shop): string {
  const items: any[] = g?.items || [];
  const rows = items.map((it, i) => `
    <tr>
      <td class="n">${i + 1}</td>
      <td>${esc(it.product_name || 'Item')}${it.sku ? `<div class="sub">${esc(it.sku)}</div>` : ''}</td>
      <td>${esc(it.batch_no || '—')}</td>
      <td>${esc(expiryText(it.expiry))}</td>
      <td class="r">${Number(it.qty || 0)}</td>
      <td class="r">${Number(it.free_qty || 0) || '—'}</td>
      <td class="r">${it.cost_price != null ? money(it.cost_price) : '—'}</td>
      <td class="r">${money(it.line_total)}</td>
    </tr>`).join('');

  const units = items.reduce((s, i) => s + Number(i.qty || 0) + Number(i.free_qty || 0), 0);
  const diff = g?.invoice_total != null ? Number(g.invoice_total) - Number(g.total_cost || 0) : null;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${grnNo(g?.grn_no)}</title><style>
  *{box-sizing:border-box}
  body{margin:0;font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;color:#000}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:10px}
  .brand{display:flex;gap:12px;align-items:center}
  .brand h1{margin:0;font-size:17pt}
  .brand p{margin:2px 0 0;font-size:9.5pt}
  .doc{text-align:right}
  .doc h2{margin:0;font-size:15pt;letter-spacing:.06em}
  .doc .no{font-size:13pt;font-weight:700;margin-top:2px}
  .void{display:inline-block;margin-top:6px;border:2px solid #000;padding:2px 10px;font-weight:700;letter-spacing:.1em}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
  .meta div{border:1px solid #000;padding:6px 8px}
  .meta b{display:block;font-size:8pt;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
  table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
  th{font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;text-align:left;border-bottom:1.5px solid #000;padding:5px 6px}
  td{padding:5px 6px;border-bottom:1px solid #999;vertical-align:top}
  .r{text-align:right} .n{width:26px}
  .sub{font-size:8.5pt}
  .tot{margin-top:10px;margin-left:auto;width:300px}
  .tot div{display:flex;justify-content:space-between;padding:3px 0}
  .tot .big{border-top:2px solid #000;font-weight:700;font-size:12.5pt;padding-top:6px}
  .notes{margin-top:14px;border:1px solid #000;padding:6px 8px;font-size:10pt}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:56px}
  .sign div{border-top:1px solid #000;padding-top:4px;font-size:9.5pt}
  .foot{margin-top:18px;font-size:8.5pt}
  </style></head><body>
  <div class="top">
    <div class="brand">${markSVG(shop.mark)}<div>
      <h1>${esc(shop.name)}</h1>
      ${shop.address ? `<p>${esc(shop.address)}</p>` : ''}
      ${shop.phone || shop.regno ? `<p>${shop.phone ? 'Tel: ' + esc(shop.phone) : ''}${shop.phone && shop.regno ? ' · ' : ''}${shop.regno ? 'Reg: ' + esc(shop.regno) : ''}</p>` : ''}
    </div></div>
    <div class="doc">
      <h2>GOODS RECEIVED NOTE</h2>
      <div class="no">${grnNo(g?.grn_no)}</div>
      ${g?.voided_at ? '<div class="void">CANCELLED</div>' : ''}
    </div>
  </div>
  <div class="meta">
    <div><b>Supplier</b>${esc(g?.supplier_name || '—')}</div>
    <div><b>Supplier invoice</b>${esc(g?.invoice_no || '—')}</div>
    <div><b>Invoice date</b>${esc(day(g?.invoice_date) || '—')}</div>
    <div><b>Received</b>${esc(day(g?.created_at))}${g?.created_by_name ? ' · ' + esc(g.created_by_name) : ''}</div>
  </div>
  <table>
    <thead><tr><th class="n">#</th><th>Item</th><th>Batch</th><th>Expiry</th><th class="r">Qty</th><th class="r">Free</th><th class="r">Unit cost</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="tot">
    <div><span>Lines</span><span>${items.length}</span></div>
    <div><span>Units received</span><span>${units}</span></div>
    <div class="big"><span>Total cost</span><span>Rs. ${money(g?.total_cost)}</span></div>
    ${g?.invoice_total != null ? `<div><span>Supplier invoice total</span><span>Rs. ${money(g.invoice_total)}</span></div>
    <div><span>${Math.abs(diff!) < 0.005 ? 'Difference' : diff! > 0 ? 'Invoice higher by' : 'Invoice lower by'}</span><span>${Math.abs(diff!) < 0.005 ? 'None' : 'Rs. ' + money(Math.abs(diff!))}</span></div>` : ''}
  </div>
  ${g?.notes ? `<div class="notes"><b>Notes:</b> ${esc(g.notes)}</div>` : ''}
  ${g?.voided_at ? `<div class="notes"><b>Cancelled</b> ${esc(day(g.voided_at))}${g.void_reason ? ' — ' + esc(g.void_reason) : ''}</div>` : ''}
  <div class="sign"><div>Received by</div><div>Checked by</div></div>
  <div class="foot">Printed ${esc(new Date().toLocaleString('en-GB'))}</div>
  </body></html>`;
}

export function grnRollHTML(g: any, shop: Shop): string {
  const items: any[] = g?.items || [];
  const rows = items.map((it) => `
    <div class="it">
      <div class="nm">${esc(it.product_name || 'Item')}</div>
      <div class="ln"><span>${Number(it.qty || 0)}${Number(it.free_qty || 0) ? ' +' + Number(it.free_qty) + ' free' : ''}
        × ${it.cost_price != null ? money(it.cost_price) : '—'}</span><span>${money(it.line_total)}</span></div>
      <div class="sm">${it.batch_no ? 'Batch ' + esc(it.batch_no) + '  ' : ''}${it.expiry ? 'Exp ' + esc(expiryText(it.expiry)) : ''}</div>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
  body{margin:0;font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#000}
  .w{width:72mm;padding:2mm 0}
  .c{text-align:center} h1{font-size:14px;margin:4px 0 0} h2{font-size:12px;margin:6px 0 0;letter-spacing:.08em}
  .rule{border-top:1px dashed #000;margin:6px 0}
  .kv{display:flex;justify-content:space-between}
  .it{margin:4px 0} .nm{font-weight:600}
  .ln{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}
  .sm{font-size:10px}
  .tot{display:flex;justify-content:space-between;font-weight:700;font-size:13px}
  </style></head><body><div class="w">
  <div class="c">${markSVG(shop.mark)}<h1>${esc(shop.name)}</h1><h2>GOODS RECEIVED</h2>
  <div><b>${grnNo(g?.grn_no)}</b>${g?.voided_at ? ' — CANCELLED' : ''}</div></div>
  <div class="rule"></div>
  <div class="kv"><span>Supplier</span><span>${esc(g?.supplier_name || '—')}</span></div>
  <div class="kv"><span>Invoice</span><span>${esc(g?.invoice_no || '—')}</span></div>
  <div class="kv"><span>Received</span><span>${esc(day(g?.created_at))}</span></div>
  <div class="rule"></div>
  ${rows}
  <div class="rule"></div>
  <div class="tot"><span>TOTAL COST</span><span>Rs. ${money(g?.total_cost)}</span></div>
  <div class="kv"><span>Lines / units</span><span>${items.length} / ${Number(g?.unit_count || 0)}</span></div>
  <div class="rule"></div>
  <div style="margin-top:22px">Received by ____________________</div>
  </div></body></html>`;
}
