import { useEffect, useState } from 'react';
import { useToast } from './Toast';
import { useShop } from '../lib/shop';
import { formatLKR } from '../lib/format';
import { markSVG, esc } from '../lib/receipt';
import { ui } from '../lib/ui';

/**
 * What to order, grouped by who to order it from.
 *
 * The suggested amount covers two weeks at the rate each item sold over the
 * last 30 days; every amount can be changed before the order goes out. An
 * order leaves as a WhatsApp message (the owner presses Send in WhatsApp), as
 * text to paste anywhere, or as a PDF.
 */

/** 0771234567 → 94771234567, the form wa.me wants. */
function waNumber(phone?: string | null) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('94')) return d;
  if (d.startsWith('0')) return '94' + d.slice(1);
  return d.length === 9 ? '94' + d : d;
}

export default function ReorderReport({ darkMode }: { darkMode?: boolean }) {
  const t = ui(darkMode);
  const toast = useToast();
  const shop = useShop();
  const [data, setData] = useState<any>(null);
  const [qty, setQty] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const r: any = await (window as any).api?.reports?.reorder?.(30, 14);
      if (r?.ok) {
        setData(r.data);
        const q: Record<string, string> = {};
        for (const g of r.data.groups) for (const i of g.items) if (i.suggest) q[i.id] = String(i.suggest);
        setQty(q);
      }
    })();
  }, []);

  const lines = (g: any) => g.items.filter((i: any) => Number(qty[i.id]) > 0);

  function message(g: any) {
    const ls = lines(g);
    return [`Order from ${shop.name}${shop.phone ? ' (' + shop.phone + ')' : ''}`,
      new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), '',
      ...ls.map((i: any) => `• ${i.name} — ${qty[i.id]}`), '', 'Thank you.'].join('\n');
  }

  async function copy(g: any) {
    if (!lines(g).length) { toast.error('Type an amount for at least one item'); return; }
    try { await navigator.clipboard.writeText(message(g)); toast.success('Order copied — paste it into a message'); }
    catch { toast.error('Could not copy'); }
  }

  function whatsapp(g: any) {
    if (!lines(g).length) { toast.error('Type an amount for at least one item'); return; }
    const n = waNumber(g.phone);
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(message(g))}`, '_blank');
  }

  async function pdf(g: any) {
    const ls = lines(g);
    if (!ls.length) { toast.error('Type an amount for at least one item'); return; }
    const rows = ls.map((i: any, n: number) => `<tr><td>${n + 1}</td><td>${esc(i.name)}<div class="s">${esc(i.sku || '')}</div></td><td class="r">${esc(qty[i.id])}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;color:#000;margin:0}
      .top{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:8px}
      .b{display:flex;gap:10px;align-items:center} h1{margin:0;font-size:16pt} h2{margin:0;font-size:14pt;letter-spacing:.06em}
      table{width:100%;border-collapse:collapse;margin-top:14px} th{text-align:left;font-size:9pt;text-transform:uppercase;border-bottom:1.5px solid #000;padding:5px}
      td{padding:6px 5px;border-bottom:1px solid #999} .r{text-align:right} .s{font-size:8.5pt} .m{margin-top:10px}
    </style></head><body>
      <div class="top"><div class="b">${markSVG(shop.mark)}<div><h1>${esc(shop.name)}</h1>${shop.phone ? `<div>Tel: ${esc(shop.phone)}</div>` : ''}</div></div>
      <div style="text-align:right"><h2>PURCHASE ORDER</h2><div>${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div></div></div>
      <div class="m"><b>To:</b> ${esc(g.supplier || 'Supplier')}${g.phone ? ' · ' + esc(g.phone) : ''}</div>
      <table><thead><tr><th>#</th><th>Item</th><th class="r">Quantity</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;
    const name = `order-${(g.supplier || 'supplier').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${new Date().toLocaleDateString('en-CA')}`;
    const r: any = await (window as any).api?.util?.saveDocumentPDF?.(html, name, 'Orders', true);
    if (r?.ok) toast.success('Order saved to ' + r.data.path); else toast.error(r?.message || 'Could not save the PDF');
  }

  if (!data) return <p className={`text-center py-10 text-sm ${t.muted}`}>Working out what to order…</p>;
  if (!data.groups.length) return (
    <div className={`${t.card} p-10 text-center`}>
      <p className={`font-semibold ${t.page}`}>Nothing needs ordering</p>
      <p className={`text-sm mt-1 ${t.muted}`}>Every item has more than 10 in stock and at least a week's worth at its recent rate.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className={`text-sm ${t.muted}`}>
        {data.count} item{data.count === 1 ? '' : 's'} out, low, or under a week's stock. Suggested amounts cover two weeks at the last 30 days' rate — change any before sending.
      </p>
      {data.groups.map((g: any) => {
        const est = lines(g).reduce((s: number, i: any) => s + Number(qty[i.id]) * Number(i.cost || 0), 0);
        return (
          <div key={g.supplier || 'none'} className={`${t.card} overflow-hidden`}>
            <div className={`px-5 py-3 flex items-center gap-3 flex-wrap border-b ${t.border}`}>
              <div className="min-w-0">
                <h3 className={`font-bold ${t.page}`}>{g.supplier || 'No supplier recorded yet'}</h3>
                <p className={`text-xs ${t.muted}`}>{g.phone || (g.supplier ? 'No phone number — add one under People → Suppliers' : 'Receive these through a GRN once and they will group under their supplier')}</p>
              </div>
              <div className="ml-auto flex gap-2">
                <button onClick={() => copy(g)} className={t.btnGhost}>Copy</button>
                <button onClick={() => pdf(g)} className={t.btnGhost}>Save PDF</button>
                <button onClick={() => whatsapp(g)} className={t.btnSuccess}>WhatsApp</button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead><tr>
                <th className={t.th}>Item</th><th className={`${t.th} text-right`}>In stock</th>
                <th className={`${t.th} text-right`}>Sold (30 days)</th><th className={`${t.th} text-right`}>Lasts</th>
                <th className={`${t.th} w-32 text-right`}>Order</th>
              </tr></thead>
              <tbody>
                {g.items.map((i: any) => (
                  <tr key={i.id}>
                    <td className={`${t.td} ${t.page}`}>{i.name}<span className={`block text-[11px] ${t.muted}`}>{i.category || i.sku}</span></td>
                    <td className={`${t.td} text-right tabular-nums font-semibold ${i.stock <= 0 ? 'text-red-600' : 'text-amber-600'}`}>{i.stock <= 0 ? 'Out' : i.stock}</td>
                    <td className={`${t.td} text-right tabular-nums ${t.page}`}>{i.sold}</td>
                    <td className={`${t.td} text-right tabular-nums ${t.muted}`}>{i.daysLeft == null ? '—' : i.daysLeft === 0 ? 'today' : `${i.daysLeft} days`}</td>
                    <td className={t.td}>
                      <input inputMode="numeric" className={`${t.input} !py-1.5 text-right`} placeholder="—"
                        aria-label={`Order quantity for ${i.name}`} value={qty[i.id] || ''}
                        onChange={(e) => setQty({ ...qty, [i.id]: e.target.value.replace(/\D/g, '') })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {est > 0 && <p className={`px-5 py-2 text-sm text-right ${t.muted}`}>About <b className={t.page}>{formatLKR(est)}</b> at last cost</p>}
          </div>
        );
      })}
    </div>
  );
}
