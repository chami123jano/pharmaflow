import { useEffect, useState } from 'react';
import { useToast } from './Toast';
import { useShop } from '../lib/shop';
import { formatLKR } from '../lib/format';
import { cashUpHTML } from '../lib/slips';
import { ui } from '../lib/ui';

/**
 * Close the day: count the drawer against what the bills say should be there.
 *
 * Counting by note is quicker and less error-prone than adding up in your
 * head, so the drawer is entered as "how many of each note"; the total and
 * the difference follow as you type.
 */
const NOTES = [5000, 2000, 1000, 500, 100, 50, 20];

export default function CashUpDialog({ user, darkMode, onClose }: { user: any; darkMode?: boolean; onClose: () => void }) {
  const t = ui(darkMode);
  const toast = useToast();
  const shop = useShop();
  const [p, setP] = useState<any>(null);
  const [float, setFloat] = useState('');
  const [count, setCount] = useState<Record<string, string>>({});
  const [coins, setCoins] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const r: any = await (window as any).api?.cashup?.preview?.();
      if (r?.ok) { setP(r.data); setFloat(r.data.float ? String(r.data.float) : ''); }
      else toast.error('Could not work out the day');
    })();
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  const counted = NOTES.reduce((s, n) => s + n * Number(count[n] || 0), 0) + Number(coins || 0);
  const expected = p ? Number(float || 0) + p.cashSales - p.cashRefunds : 0;
  const diff = Math.round((counted - expected) * 100) / 100;
  const entered = NOTES.some((n) => count[n]) || coins !== '';

  async function save() {
    setBusy(true);
    try {
      const den: Record<string, number> = {};
      for (const n of NOTES) if (Number(count[n]) > 0) den[n] = Number(count[n]);
      if (Number(coins) > 0) den.coins = Number(coins);
      const r: any = await (window as any).api?.cashup?.save?.({ float: Number(float || 0), counted, denominations: den, notes, user_id: user?.id });
      if (!r?.ok) { toast.error(r?.message || 'Could not save'); return; }
      const d = r.data.difference;
      toast.success(Math.abs(d) < 0.005 ? 'Day closed — the drawer balances' : `Day closed — ${formatLKR(Math.abs(d))} ${d > 0 ? 'over' : 'short'}`);
      onClose();
      const html = cashUpHTML(r.data, shop);
      void (async () => {
        try { const pr: any = await (window as any).api?.util?.printHTML?.(html); if (!pr?.ok && pr?.error !== 'CANCELLED') toast.error(pr?.message || 'Could not print'); } catch {}
        try { await (window as any).api?.util?.saveReceiptPDF?.(html, `cashup-${new Date().toLocaleDateString('en-CA')}-${new Date().toTimeString().slice(0, 5).replace(':', '')}`); } catch {}
      })();
    } finally { setBusy(false); }
  }

  const Row = ({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) => (
    <div className={`flex justify-between py-1.5 ${strong ? `font-bold text-base border-t ${t.border} mt-1 pt-2.5` : 'text-sm'}`}>
      <span className={strong ? t.page : t.muted}>{label}</span>
      <span className={`tabular-nums ${t.page}`}>{minus ? '−' : ''}{formatLKR(value)}</span>
    </div>
  );

  return (
    <div className={t.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${t.modal} max-w-3xl max-h-[92vh] overflow-auto`} role="dialog" aria-modal="true" aria-label="Close the day">
        <div className={`p-5 border-b ${t.border}`}>
          <h2 className={`text-xl font-bold ${t.page}`}>Close the day</h2>
          {p && <p className={`text-sm mt-0.5 ${t.muted}`}>
            Since {new Date(p.periodStart).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' · '}{p.salesCount} bill{p.salesCount === 1 ? '' : 's'}{p.returnsCount ? ` · ${p.returnsCount} return${p.returnsCount === 1 ? '' : 's'}` : ''}
          </p>}
        </div>
        {p && (
          <div className="p-5 grid md:grid-cols-2 gap-6">
            <div>
              <h3 className={`text-[11px] font-semibold uppercase tracking-wider mb-2 ${t.muted}`}>What the bills say</h3>
              <label className={t.label}>Float (cash in the drawer at the start)</label>
              <input inputMode="decimal" className={`${t.input} mb-3`} value={float} placeholder="0.00"
                onChange={(e) => setFloat(e.target.value.replace(/[^\d.]/g, ''))} />
              <Row label="Cash sales" value={p.cashSales} />
              <Row label="Cash given back" value={p.cashRefunds} minus />
              <Row label="Should be in the drawer" value={expected} strong />
              <div className={`mt-4 text-sm ${t.muted}`}>
                <div className="flex justify-between"><span>Card sales (not in the drawer)</span><span className="tabular-nums">{formatLKR(p.cardSales)}</span></div>
                {p.cardRefunds > 0 && <div className="flex justify-between"><span>Card refunds</span><span className="tabular-nums">−{formatLKR(p.cardRefunds)}</span></div>}
              </div>
            </div>
            <div>
              <h3 className={`text-[11px] font-semibold uppercase tracking-wider mb-2 ${t.muted}`}>Count the drawer</h3>
              <div className="grid grid-cols-2 gap-2">
                {NOTES.map((n) => (
                  <label key={n} className={`${t.well} flex items-center gap-2 px-3 py-1.5`}>
                    <span className={`w-16 text-sm font-semibold ${t.page}`}>Rs. {n.toLocaleString()}</span>
                    <span className={t.muted}>×</span>
                    <input inputMode="numeric" aria-label={`Number of Rs. ${n} notes`} placeholder="0"
                      className="w-full bg-transparent text-right tabular-nums outline-none font-semibold"
                      value={count[n] || ''} onChange={(e) => setCount({ ...count, [n]: e.target.value.replace(/\D/g, '') })} />
                  </label>
                ))}
                <label className={`${t.well} flex items-center gap-2 px-3 py-1.5`}>
                  <span className={`w-16 text-sm font-semibold ${t.page}`}>Coins</span>
                  <span className={t.muted}>Rs.</span>
                  <input inputMode="decimal" aria-label="Coins total" placeholder="0"
                    className="w-full bg-transparent text-right tabular-nums outline-none font-semibold"
                    value={coins} onChange={(e) => setCoins(e.target.value.replace(/[^\d.]/g, ''))} />
                </label>
              </div>
              <div className={`mt-3 flex justify-between font-bold text-base ${t.page}`}><span>Counted</span><span className="tabular-nums">{formatLKR(counted)}</span></div>
              {entered && (
                <div className={`mt-3 rounded-xl px-4 py-3 text-center font-bold text-lg ${
                  Math.abs(diff) < 0.005 ? 'bg-lime-100 text-lime-900' : diff > 0 ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'}`}>
                  {Math.abs(diff) < 0.005 ? 'Balanced' : `${formatLKR(Math.abs(diff))} ${diff > 0 ? 'over' : 'short'}`}
                </div>
              )}
            </div>
            <div className="md:col-span-2 flex gap-3 items-center">
              <input className={`${t.input} flex-1`} placeholder="Note (optional) — e.g. Rs. 200 taken for milk" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <button onClick={onClose} className={t.btnGhost}>Cancel</button>
              <button onClick={save} disabled={busy || !entered} className={`${t.btnPrimary} px-6`}>{busy ? 'Saving…' : 'Close the day'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
