import { useCallback, useEffect, useState } from 'react';
import { lkr, startOfDay, startOfMonth } from '../lib/format';
import { load, loadIn, SETUP_TEXT } from '../lib/owner';
import { Spinner, Empty, ErrorNote, Stat } from '../components/ui';

/**
 * Profit, the same way the till works it out: what customers paid (after
 * discounts and refunds) less what those exact units cost. Items sold with no
 * cost price are left out rather than counted as pure profit.
 */
type Range = '1' | '7' | '30' | 'month';
const RANGES: { key: Range; label: string }[] = [
  { key: '1', label: 'Today' }, { key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: 'month', label: 'This month' },
];

export default function Profit() {
  const [range, setRange] = useState<Range>('7');
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRes(null); setError(null);
    const from = range === 'month' ? startOfMonth() : startOfDay(Number(range) - 1);
    const sales = await load<any>('sales', '*', from);
    if (sales.error) { setError(sales.error); return; }
    const live = sales.rows.filter((s) => !s.voided_at);
    const lines = await loadIn<any>('sale_items', '*', 'sale_id', live.map((s) => s.id));
    if (lines.error) { setError(lines.error); return; }
    const rets = await load<any>('sale_returns', '*', from);
    const retItems = rets.rows.length ? await loadIn<any>('sale_return_items', '*', 'return_id', rets.rows.map((r) => r.id)) : { rows: [], missing: false };
    const costKnown = lines.rows.some((l) => 'unit_cost' in l);

    const byId = new Map(live.map((s) => [s.id, s]));
    const items = new Map<string, any>();
    const t = { revenue: 0, costed: 0, cost: 0, uncosted: 0, refunds: 0 };
    const item = (k: string, name: string) => items.get(k) || { name, qty: 0, revenue: 0, costed: 0, cost: 0, uncosted: 0 };
    for (const l of lines.rows) {
      const s: any = byId.get(l.sale_id);
      if (!s) continue;
      const net = Number(l.line_total) * (Number(s.subtotal) > 0 ? Number(s.total) / Number(s.subtotal) : 1);
      const it = item(l.product_id || l.product_name, l.product_name || 'Item');
      it.qty += Number(l.quantity); it.revenue += net; t.revenue += net;
      if (l.unit_cost == null) { it.uncosted += net; t.uncosted += net; }
      else { const c = Number(l.unit_cost) * Number(l.quantity); it.costed += net; it.cost += c; t.costed += net; t.cost += c; }
      items.set(l.product_id || l.product_name, it);
    }
    // Returns count on the day the money went back, whichever day the bill was.
    for (const x of retItems.rows) {
      const refund = Number(x.refund || 0);
      const it = item(x.product_id || x.product_name, x.product_name || 'Item');
      it.revenue -= refund; t.revenue -= refund; t.refunds += refund;
      if (x.restocked) it.qty -= Number(x.qty || 0);
      if (x.unit_cost == null) { it.uncosted -= refund; t.uncosted -= refund; }
      else {
        const back = x.restocked ? Number(x.unit_cost) * Number(x.qty || 0) : 0;
        it.costed -= refund; it.cost -= back; t.costed -= refund; t.cost -= back;
      }
      items.set(x.product_id || x.product_name, it);
    }
    const list = [...items.values()].map((i) => ({ ...i, profit: i.costed - i.cost, margin: i.costed > 0 ? ((i.costed - i.cost) / i.costed) * 100 : null }))
      .sort((a, b) => b.profit - a.profit);
    setRes({ t, list, bills: live.length, setup: !costKnown || rets.missing });
  }, [range]);

  useEffect(() => { run(); }, [run]);

  const profit = res ? res.t.costed - res.t.cost : 0;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Profit</h1>
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setRange(r.key)}
            className={`flex-1 rounded-xl px-2 py-2 text-sm font-bold transition ${range === r.key ? 'bg-teal-700 text-white' : 'card muted'}`}>{r.label}</button>
        ))}
      </div>
      {error ? <ErrorNote error={error} onRetry={run} />
        : !res ? <Spinner label="Working it out…" />
        : res.setup && res.bills > 0 && res.t.cost === 0 ? <Empty icon="🧮" title="Costs are not on the website yet" body={SETUP_TEXT} />
        : res.bills === 0 ? <Empty icon="🧮" title="No sales in this period" body="Profit appears once the till has sales and syncs." />
        : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Gross profit" value={lkr(profit)} sub={res.t.costed > 0 ? `${((profit / res.t.costed) * 100).toFixed(1)}% margin` : 'No costs yet'}
                tone={profit < 0 ? 'text-red-500' : 'text-lime-500'} />
              <Stat label="Sales" value={lkr(res.t.revenue)} sub={`${res.bills} bills${res.t.refunds ? ` · ${lkr(res.t.refunds)} refunded` : ''}`} />
              <Stat label="Cost of goods" value={lkr(res.t.cost)} sub="What those items cost you" />
              <Stat label="No cost price" value={lkr(res.t.uncosted)} sub="Sales left out of profit" tone={res.t.uncosted > 0 ? 'text-amber-500' : ''} />
            </div>
            <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
              <p className="faint px-4 pt-3 pb-2 text-[11px] font-bold uppercase tracking-wide">By item</p>
              {res.list.map((i: any) => (
                <div key={i.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{i.name}</p>
                    <p className="muted text-xs">{i.qty} sold · {lkr(i.revenue)}{i.uncosted > 0 ? ' · some without cost' : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold tabular-nums ${i.profit < 0 ? 'text-red-500' : ''}`}>{i.costed > 0 ? lkr(i.profit) : '—'}</p>
                    <p className="faint text-xs">{i.margin == null ? 'no cost' : `${i.margin.toFixed(0)}%`}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
    </div>
  );
}
