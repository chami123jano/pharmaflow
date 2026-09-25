import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { lkr, lkrShort, dayName, startOfDay, startOfMonth } from '../lib/format';
import { Spinner, Empty, ErrorNote, Stat } from '../components/ui';

type Range = '7' | '30' | 'month';

const RANGES: { key: Range; label: string }[] = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: 'month', label: 'This month' },
];

interface Row { id: string; total: number; discount_amount: number; created_at: string; payment_method: string | null }
interface Line { sale_id: string; product_name: string | null; quantity: number; line_total: number }

export default function Reports() {
  const [range, setRange] = useState<Range>('7');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    const from = range === 'month' ? startOfMonth() : startOfDay(Number(range) - 1);

    // Voided sales are excluded here rather than filtered afterwards, so no
    // total on this page can ever include one.
    const { data, error } = await supabase
      .from('sales')
      .select('id,total,discount_amount,created_at,payment_method')
      .gte('created_at', from)
      .is('voided_at', null)
      .order('created_at', { ascending: true })
      .limit(5000);
    if (error) { setError(error.message); return; }
    const sales = (data || []) as Row[];
    setRows(sales);

    if (sales.length === 0) { setLines([]); return; }
    // Chunked: a URL listing several thousand ids would be rejected for length.
    const ids = sales.map((s) => s.id);
    const out: Line[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data: li } = await supabase
        .from('sale_items').select('sale_id,product_name,quantity,line_total')
        .in('sale_id', ids.slice(i, i + 200));
      if (li) out.push(...(li as Line[]));
    }
    setLines(out);
  }, [range]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Reports</h1>

      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition ${
              range === r.key ? 'bg-blue-600 text-white' : 'card muted'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error ? <ErrorNote error={error} onRetry={load} />
        : !rows ? <Spinner label="Adding it up…" />
        : rows.length === 0 ? <Empty icon="📊" title="No sales in this period" body="Once the till syncs, its takings show up here." />
        : <Body rows={rows} lines={lines} />}
    </div>
  );
}

function Body({ rows, lines }: { rows: Row[]; lines: Line[] }) {
  const takings = rows.reduce((a, r) => a + Number(r.total || 0), 0);
  const discounts = rows.reduce((a, r) => a + Number(r.discount_amount || 0), 0);
  const average = rows.length ? takings / rows.length : 0;

  // Per day, keyed by local date so the buckets match the shop's clock.
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = new Date(r.created_at);
    d.setHours(0, 0, 0, 0);
    const k = d.toISOString();
    byDay.set(k, (byDay.get(k) || 0) + Number(r.total || 0));
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const peak = Math.max(...days.map((d) => d[1]), 1);
  const best = days.reduce((a, b) => (b[1] > a[1] ? b : a), days[0]);

  const byPayment = new Map<string, number>();
  for (const r of rows) {
    const k = r.payment_method || 'unknown';
    byPayment.set(k, (byPayment.get(k) || 0) + Number(r.total || 0));
  }

  const byProduct = new Map<string, { qty: number; value: number }>();
  for (const l of lines) {
    const k = l.product_name || 'Unknown item';
    const cur = byProduct.get(k) || { qty: 0, value: 0 };
    cur.qty += Number(l.quantity || 0);
    cur.value += Number(l.line_total || 0);
    byProduct.set(k, cur);
  }
  const top = [...byProduct.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 10);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Takings" value={lkr(takings)} sub={`${rows.length} sales`} />
        <Stat label="Average sale" value={lkr(average)} sub={`Best day ${lkrShort(best[1])}`} />
      </div>

      {discounts > 0 && (
        <div className="card p-4">
          <p className="faint text-[11px] font-bold uppercase tracking-wide">Given away in discounts</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{lkr(discounts)}</p>
          <p className="muted mt-0.5 text-xs">
            {((discounts / (takings + discounts)) * 100).toFixed(1)}% of what the bills came to
          </p>
        </div>
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-bold">Day by day</h2>
        <ul className="space-y-2">
          {days.map(([iso, value]) => (
            <li key={iso} className="flex items-center gap-3">
              <span className="faint w-20 shrink-0 text-xs">{dayName(iso)}</span>
              <div className="h-6 flex-1 overflow-hidden rounded-md" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-md bg-blue-600 transition-all"
                  style={{ width: `${Math.max((value / peak) * 100, 2)}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-xs font-bold">{lkrShort(value)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-bold">How people paid</h2>
        <ul className="space-y-2">
          {[...byPayment.entries()].sort((a, b) => b[1] - a[1]).map(([method, value]) => (
            <li key={method} className="flex items-center justify-between gap-3 text-sm">
              <span className="capitalize">{method}</span>
              <span className="flex items-center gap-3">
                <span className="faint text-xs">{((value / takings) * 100).toFixed(0)}%</span>
                <span className="font-bold">{lkr(value)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-bold">Best sellers</h2>
        {top.length === 0 ? (
          <p className="faint text-sm">No line items recorded for this period.</p>
        ) : (
          <ol className="space-y-2.5">
            {top.map(([name, v], i) => (
              <li key={name} className="flex items-center gap-3">
                <span className="faint w-5 shrink-0 text-xs font-bold">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                <span className="faint shrink-0 text-xs">{v.qty} sold</span>
                <span className="w-20 shrink-0 text-right text-sm font-bold">{lkrShort(v.value)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
