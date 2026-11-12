import { useCallback, useEffect, useState } from 'react';
import { lkr, dateTime } from '../lib/format';
import { load, loadIn, SETUP_TEXT } from '../lib/owner';
import { Spinner, Empty, ErrorNote, Pill } from '../components/ui';

/** Goods received notes from the till: who delivered what, and what it cost. */
export default function Deliveries() {
  const [grns, setGrns] = useState<any[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, any[]>>({});

  const run = useCallback(async () => {
    setGrns(null); setError(null);
    const r = await load<any>('grns', '*', undefined, { limit: 300 });
    if (r.error) { setError(r.error); return; }
    setMissing(r.missing);
    setGrns(r.rows);
  }, []);
  useEffect(() => { run(); }, [run]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!lines[id]) {
      const r = await loadIn<any>('grn_items', '*', 'grn_id', [id]);
      setLines((p) => ({ ...p, [id]: r.rows }));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Deliveries</h1>
      {error ? <ErrorNote error={error} onRetry={run} />
        : !grns ? <Spinner label="Loading deliveries…" />
        : missing ? <Empty icon="📦" title="Deliveries are not on the website yet" body={SETUP_TEXT} />
        : grns.length === 0 ? <Empty icon="📦" title="No deliveries yet" body="Stock received at the till through Receive stock shows up here." />
        : (
          <div className="space-y-2">
            {grns.map((g) => (
              <div key={g.id} className={`card ${g.voided_at ? 'opacity-60' : ''}`}>
                <button onClick={() => toggle(g.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">GRN-{String(g.grn_no).padStart(4, '0')} {g.voided_at && <Pill tone="bad">Cancelled</Pill>}</p>
                    <p className="muted truncate text-xs">{g.supplier_name || 'No supplier'}{g.invoice_no ? ` · inv ${g.invoice_no}` : ''} · {dateTime(g.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold tabular-nums ${g.voided_at ? 'line-through' : ''}`}>{lkr(g.total_cost)}</p>
                    <p className="faint text-xs">{g.line_count} lines · {g.unit_count} units</p>
                  </div>
                </button>
                {open === g.id && (
                  <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border)' }}>
                    {!lines[g.id] ? <p className="faint py-2 text-xs">Loading…</p> : lines[g.id].map((l) => (
                      <div key={l.id} className="flex justify-between gap-3 py-1.5 text-sm">
                        <span className="min-w-0 truncate">{l.product_name}
                          <span className="faint block text-xs">{[l.batch_no && `batch ${l.batch_no}`, l.expiry && `exp ${String(l.expiry).slice(0, 7)}`].filter(Boolean).join(' · ')}</span></span>
                        <span className="shrink-0 text-right tabular-nums">{l.qty}{l.free_qty ? ` +${l.free_qty}` : ''} × {l.cost_price != null ? lkr(l.cost_price) : '—'}
                          <span className="faint block text-xs">{lkr(l.line_total)}</span></span>
                      </div>
                    ))}
                    {g.notes && <p className="muted pt-1 text-xs">Note: {g.notes}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
