import { useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';
import { useShop } from '../lib/shop';
import { formatLKR } from '../lib/format';
import { returnSlipHTML } from '../lib/slips';
import { ui } from '../lib/ui';

/**
 * Taking items back from a bill.
 *
 * Bill number first (it is on the receipt), then how many of each line are
 * coming back. The refund is worked out — the customer gets back what they
 * paid, discount included — and each line can be put back on the shelf or
 * not: opened or damaged medicine should not be sold again.
 *
 * A cashier needs an admin's password, like a large discount.
 */
export default function ReturnDialog({ user, darkMode, onClose, onDone }: {
  user: any; darkMode?: boolean; onClose: () => void; onDone?: () => void;
}) {
  const t = ui(darkMode);
  const dm = !!darkMode;
  const toast = useToast();
  const shop = useShop();
  const isAdmin = user?.role === 'admin';

  const [billNo, setBillNo] = useState('');
  const [bill, setBill] = useState<any>(null);
  const [err, setErr] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const billRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => billRef.current?.focus(), 30); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  async function lookup() {
    setErr(''); setBill(null);
    const r: any = await (window as any).api?.returns?.lookup?.(billNo);
    if (!r?.ok) { setErr(r?.message || 'Bill not found'); return; }
    setBill(r.data);
    setMethod(String(r.data.sale.payment_method || 'cash').toLowerCase() === 'card' ? 'card' : 'cash');
    setQty({}); setRestock(Object.fromEntries(r.data.lines.map((l: any) => [l.id, true])));
    setTimeout(() => document.querySelector<HTMLInputElement>('[data-ret-qty]')?.focus(), 50);
  }

  const lines: any[] = bill?.lines || [];
  const left = bill ? Number(bill.sale.total) - Number(bill.sale.refunded || 0) : 0;
  const chosen = lines.filter((l) => Number(qty[l.id] || 0) > 0);
  let refund = chosen.reduce((s, l) => s + Math.round(l.refund_each * Number(qty[l.id]) * 100) / 100, 0);
  refund = Math.min(Math.round(refund * 100) / 100, Math.round(left * 100) / 100);
  const bad = chosen.find((l) => Number(qty[l.id]) > l.returnable || !Number.isInteger(Number(qty[l.id])));

  async function confirm() {
    if (!chosen.length) { toast.error('Type how many are coming back'); return; }
    if (bad) { toast.error(`Only ${bad.returnable} of ${bad.name} can come back`); return; }
    setBusy(true);
    try {
      let approverId: string | undefined;
      if (!isAdmin) {
        const v: any = await (window as any).api?.auth?.verifyAdmin?.(password);
        if (!v?.ok) { toast.error(v?.message || 'Admin password is not right'); return; }
        approverId = v.data?.id;
      }
      const r: any = await (window as any).api?.returns?.create?.({
        sale_id: bill.sale.id, method, reason, user_id: user?.id, approver_id: approverId,
        items: chosen.map((l) => ({ sale_item_id: l.id, qty: Number(qty[l.id]), restock: restock[l.id] !== false })),
      });
      if (!r?.ok) { toast.error(r?.message || 'Could not record the return'); return; }
      toast.success(`Give back ${formatLKR(r.data.refund_total)} — return #${r.data.return_no} saved`);
      window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'sales' } }));
      onDone?.();
      onClose();
      // Slip for the customer and a PDF copy, like a bill. Never holds up the counter.
      const html = returnSlipHTML(r.data, shop);
      void (async () => {
        try { const p: any = await (window as any).api?.util?.printHTML?.(html); if (!p?.ok && p?.error !== 'CANCELLED') toast.error(p?.message || 'Could not print the slip'); } catch {}
        try { await (window as any).api?.util?.saveReceiptPDF?.(html, `return-${String(r.data.return_no).padStart(4, '0')}`); } catch {}
      })();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={t.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${t.modal} max-w-3xl max-h-[92vh] flex flex-col`} role="dialog" aria-modal="true" aria-label="Return items">
        <div className={`p-5 border-b ${t.border}`}>
          <h2 className={`text-xl font-bold ${t.page}`}>Return items</h2>
          <p className={`text-sm mt-0.5 ${t.muted}`}>Type the bill number from the customer's receipt.</p>
          <div className="mt-3 flex gap-2">
            <input ref={billRef} inputMode="numeric" className={`${t.input} max-w-[200px] text-lg font-semibold`} placeholder="Bill #"
              value={billNo} onChange={(e) => setBillNo(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }} />
            <button onClick={lookup} className={t.btnPrimary}>Find bill</button>
          </div>
          {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        </div>

        {bill && (
          <>
            <div className="flex-1 min-h-0 overflow-auto">
              <p className={`px-5 pt-3 text-sm ${t.muted}`}>
                Bill #{bill.sale.receipt_no} · {new Date(bill.sale.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {' · '}paid {formatLKR(bill.sale.total)} by {bill.sale.payment_method}
                {Number(bill.sale.discount_amount) > 0 && <> · included {formatLKR(bill.sale.discount_amount)} discount</>}
                {Number(bill.sale.refunded) > 0 && <span className="text-amber-600"> · {formatLKR(bill.sale.refunded)} already given back</span>}
              </p>
              <table className="w-full text-sm mt-2">
                <thead><tr>
                  <th className={t.th}>Item</th><th className={`${t.th} text-right`}>Bought</th>
                  <th className={`${t.th} text-right`}>Each</th><th className={`${t.th} w-28 text-right`}>Returning</th>
                  <th className={`${t.th} text-center`}>Back on shelf</th>
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.id} className={l.returnable <= 0 ? 'opacity-50' : ''}>
                      <td className={`${t.td} ${t.page}`}>{l.name}
                        {l.returned > 0 && <span className={`block text-xs ${t.muted}`}>{l.returned} already returned</span>}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{l.quantity}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.muted}`}>{formatLKR(l.refund_each)}</td>
                      <td className={t.td}>
                        <input {...(i === lines.findIndex((x) => x.returnable > 0) ? { 'data-ret-qty': '' } : {})}
                          inputMode="numeric" disabled={l.returnable <= 0} placeholder="0"
                          className={`${t.input} !py-1.5 text-right ${Number(qty[l.id]) > l.returnable ? '!border-red-500' : ''}`}
                          value={qty[l.id] || ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/\D/g, '') })} />
                      </td>
                      <td className={`${t.td} text-center`}>
                        <input type="checkbox" className="w-4 h-4" disabled={l.returnable <= 0} checked={restock[l.id] !== false}
                          onChange={(e) => setRestock({ ...restock, [l.id]: e.target.checked })}
                          aria-label={`Put ${l.name} back on the shelf`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={`px-5 py-2 text-xs ${t.faint}`}>Untick "Back on shelf" for opened or damaged items — they come off the stock for good.</p>
            </div>

            <div className={`p-5 border-t ${t.border} space-y-3`}>
              <div className="flex gap-3 items-center flex-wrap">
                <div role="radiogroup" aria-label="Give back by" className={`grid grid-cols-2 p-1 rounded-xl border ${dm ? 'bg-slate-800 border-slate-600' : 'bg-slate-100 border-slate-200'}`}>
                  {(['cash', 'card'] as const).map((m) => (
                    <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${method === m ? (dm ? 'bg-slate-600 text-white' : 'bg-white text-slate-900 shadow-sm') : t.muted}`}>
                      {m === 'cash' ? 'Cash back' : 'Card refund'}</button>
                  ))}
                </div>
                <input className={`${t.input} flex-1 min-w-[200px]`} placeholder="Reason (optional) — e.g. wrong strength" value={reason}
                  onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="flex gap-3 items-center flex-wrap">
                {!isAdmin && (
                  <input type="password" className={`${t.input} max-w-[220px]`} placeholder="Admin password" value={password}
                    onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
                )}
                <div className="ml-auto flex items-center gap-4">
                  <div className="text-right">
                    <div className={`text-[11px] uppercase tracking-wider font-semibold ${t.muted}`}>Give back</div>
                    <div className={`text-2xl font-bold tabular-nums ${t.page}`}>{formatLKR(refund)}</div>
                  </div>
                  <button onClick={onClose} className={t.btnGhost}>Cancel</button>
                  <button onClick={confirm} disabled={busy || !chosen.length || !!bad || (!isAdmin && !password)} className={`${t.btnPrimary} px-6`}>
                    {busy ? 'Saving…' : 'Confirm return'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
