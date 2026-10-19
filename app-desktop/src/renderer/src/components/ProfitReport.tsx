import { useState } from 'react';
import { formatLKR } from '../lib/format';
import { ui } from '../lib/ui';

/**
 * The profit report: what was earned, what it cost, and what was left.
 *
 * Built so it cannot flatter the shop. Sales of items with no cost price are
 * not counted as pure profit — they are kept out of the profit and margin and
 * shown in their own list, with the amount, so the gap is visible and fixable.
 */
export default function ProfitReport({ data, darkMode }: { data: any; darkMode?: boolean }) {
  const t = ui(darkMode);
  const dm = !!darkMode;
  const [tab, setTab] = useState<'items' | 'missing' | 'below'>('items');
  const [sort, setSort] = useState<'profit' | 'margin' | 'revenue'>('profit');

  const s = data?.summary || {};
  const byDay: any[] = data?.byDay || [];
  const missing: any[] = data?.missingCost || [];
  const below: any[] = data?.belowCost || [];
  const items: any[] = [...(data?.byItem || [])].sort((a, b) =>
    sort === 'margin' ? (a.margin ?? 999) - (b.margin ?? 999) : sort === 'revenue' ? b.revenue - a.revenue : b.profit - a.profit);

  const pct = (m: any) => (m == null ? '—' : `${m}%`);
  const profitColour = (n: number) => (n < 0 ? 'text-red-600' : dm ? 'text-lime-400' : 'text-lime-700');

  const Card = ({ label, value, sub, strong, colour }: { label: string; value: string; sub?: string; strong?: boolean; colour?: string }) => (
    <div className={`${t.card} px-5 py-4 ${strong ? (dm ? 'ring-2 ring-lime-700/60' : 'ring-2 ring-lime-600/30') : ''}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${t.muted}`}>{label}</p>
      <p className={`mt-1 font-bold tabular-nums ${strong ? 'text-3xl' : 'text-2xl'} ${colour || t.page}`}>{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${t.muted}`}>{sub}</p>}
    </div>
  );

  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button key={k} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
        tab === k ? 'bg-teal-700 text-white' : `${t.muted} ${dm ? 'hover:bg-slate-700/50' : 'hover:bg-slate-100'}`}`}>
      {label}{n ? <span className={`ml-1.5 px-1.5 rounded-full text-[11px] ${tab === k ? 'bg-white/20' : k === 'items' ? '' : 'bg-amber-100 text-amber-800'}`}>{n}</span> : null}
    </button>
  );

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="shrink-0 grid grid-cols-2 xl:grid-cols-5 gap-4">
        <Card label="Sales" value={formatLKR(s.revenue ?? 0)} sub={`${s.salesCount ?? 0} bill${s.salesCount === 1 ? '' : 's'}, after discounts`} />
        <Card label="Cost of goods sold" value={formatLKR(s.cost ?? 0)} sub="What those items cost you" />
        <Card label="Gross profit" value={formatLKR(s.profit ?? 0)} strong colour={profitColour(s.profit ?? 0)}
          sub={s.uncostedRevenue > 0 ? 'Items without a cost left out' : 'Sales − cost'} />
        <Card label="Margin" value={pct(s.margin)} sub="Profit for every Rs. 100 sold" />
        <Card label="Discounts given" value={formatLKR(s.discount ?? 0)} sub="Already taken off sales"
          colour={Number(s.discount) > 0 ? 'text-amber-600' : undefined} />
      </div>

      {s.uncostedRevenue > 0 && (
        <div className={`shrink-0 rounded-xl border px-4 py-3 text-sm flex items-center justify-between gap-3 ${
          dm ? 'border-amber-800/60 bg-amber-950/30 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <span>
            <b>{formatLKR(s.uncostedRevenue)}</b> of sales were items with <b>no cost price</b>, so they are not in the profit.
            Add their cost in Inventory and the report fills in.
          </span>
          <button onClick={() => setTab('missing')} className="shrink-0 font-semibold underline">Show which</button>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* By day */}
        <div className={`${t.card} lg:col-span-2 flex flex-col min-h-0 overflow-hidden`}>
          <h3 className={`px-5 pt-4 pb-3 text-sm font-semibold ${t.page}`}>Day by day</h3>
          <div className="flex-1 min-h-0 overflow-auto">
            {byDay.length === 0 ? (
              <p className={`px-5 py-10 text-center text-sm ${t.muted}`}>No sales in this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0"><tr>
                  <th className={t.th}>Day</th><th className={`${t.th} text-right`}>Sales</th>
                  <th className={`${t.th} text-right`}>Profit</th><th className={`${t.th} text-right`}>Margin</th>
                </tr></thead>
                <tbody>
                  {[...byDay].reverse().map((d) => (
                    <tr key={d.date} className={t.rowHover}>
                      <td className={`${t.td} ${t.page}`}>
                        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}
                        <span className={`block text-[11px] ${t.muted}`}>{d.sales} bill{d.sales === 1 ? '' : 's'}</span>
                      </td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{formatLKR(d.revenue)}</td>
                      <td className={`${t.td} text-right tabular-nums font-semibold ${profitColour(d.profit)}`}>
                        {formatLKR(d.profit)}{!d.complete && <span className="text-amber-600" title="Some items had no cost"> *</span>}
                      </td>
                      <td className={`${t.td} text-right tabular-nums ${t.muted}`}>{pct(d.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* By item / missing / below cost */}
        <div className={`${t.card} lg:col-span-3 flex flex-col min-h-0 overflow-hidden`}>
          <div className="px-4 pt-3 pb-2 flex items-center gap-1 flex-wrap">
            <div role="tablist" className="flex gap-1">
              {tabBtn('items', 'By item')}
              {tabBtn('missing', 'No cost price', missing.length)}
              {tabBtn('below', 'Priced below cost', below.length)}
            </div>
            {tab === 'items' && (
              <div className="ml-auto flex items-center gap-1 text-xs">
                <span className={t.muted}>Sort:</span>
                {([['profit', 'Most profit'], ['margin', 'Lowest margin'], ['revenue', 'Most sales']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setSort(k)}
                    className={`px-2 py-1 rounded-md font-medium ${sort === k ? (dm ? 'bg-slate-700 text-slate-100' : 'bg-slate-200 text-slate-900') : t.muted}`}>{l}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {tab === 'items' && (items.length === 0 ? (
              <p className={`px-5 py-10 text-center text-sm ${t.muted}`}>No sales in this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0"><tr>
                  <th className={t.th}>Item</th><th className={`${t.th} text-right`}>Sold</th>
                  <th className={`${t.th} text-right`}>Sales</th><th className={`${t.th} text-right`}>Cost</th>
                  <th className={`${t.th} text-right`}>Profit</th><th className={`${t.th} text-right`}>Margin</th>
                </tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.product_id} className={t.rowHover}>
                      <td className={`${t.td} ${t.page}`}>{i.name}<span className={`block text-[11px] ${t.muted}`}>{i.category || i.sku}</span></td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{i.qty}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{formatLKR(i.revenue)}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.muted}`}>{i.cost > 0 || i.complete ? formatLKR(i.cost) : '—'}</td>
                      <td className={`${t.td} text-right tabular-nums font-semibold ${profitColour(i.profit)}`}>
                        {i.cost > 0 || i.complete ? formatLKR(i.profit) : <span className="text-amber-600 font-normal">no cost</span>}
                        {!i.complete && i.cost > 0 && <span className="text-amber-600" title="Some units had no cost"> *</span>}
                      </td>
                      <td className={`${t.td} text-right tabular-nums ${i.margin != null && i.margin < 10 ? 'text-amber-600' : t.muted}`}>{pct(i.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}

            {tab === 'missing' && (missing.length === 0 ? (
              <p className={`px-5 py-10 text-center text-sm ${t.muted}`}>Every item sold in this period has a cost price.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0"><tr>
                  <th className={t.th}>Item sold without a cost price</th><th className={`${t.th} text-right`}>Sold</th><th className={`${t.th} text-right`}>Sales</th>
                </tr></thead>
                <tbody>
                  {missing.map((m) => (
                    <tr key={m.product_id}>
                      <td className={`${t.td} ${t.page}`}>{m.name}<span className={`block text-[11px] ${t.muted}`}>{m.sku}</span></td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{m.qty}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{formatLKR(m.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}

            {tab === 'below' && (below.length === 0 ? (
              <p className={`px-5 py-10 text-center text-sm ${t.muted}`}>No item is priced at or below its cost.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0"><tr>
                  <th className={t.th}>Item</th><th className={`${t.th} text-right`}>Selling price</th>
                  <th className={`${t.th} text-right`}>Cost</th><th className={`${t.th} text-right`}>Lost on each</th>
                </tr></thead>
                <tbody>
                  {below.map((b) => (
                    <tr key={b.id}>
                      <td className={`${t.td} ${t.page}`}>{b.name}<span className={`block text-[11px] ${t.muted}`}>{b.sku}</span></td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{formatLKR(b.price)}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{formatLKR(b.cost_price)}</td>
                      <td className={`${t.td} text-right tabular-nums font-semibold text-red-600`}>{formatLKR(Number(b.cost_price) - Number(b.price))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </div>
      </div>

      {data?.stock && (
        <p className={`shrink-0 text-sm ${t.muted}`}>
          Stock on the shelf now: <b className={t.page}>{formatLKR(data.stock.atCost)}</b> at cost,
          {' '}<b className={t.page}>{formatLKR(data.stock.atPrice)}</b> at selling price
          {data.stock.atPrice > data.stock.atCost && <> — about <b className={profitColour(1)}>{formatLKR(data.stock.atPrice - data.stock.atCost)}</b> profit still to make</>}
          {data.stock.unitsWithoutCost > 0 && <span className="text-amber-600"> ({data.stock.unitsWithoutCost} units have no cost)</span>}.
        </p>
      )}
    </div>
  );
}
