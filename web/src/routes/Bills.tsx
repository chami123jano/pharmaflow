import { useCallback, useEffect, useState } from 'react';
import { lkr } from '../lib/format';
import { load, loadIn, SETUP_TEXT } from '../lib/owner';
import { Spinner, Empty, ErrorNote, Stat, Pill } from '../components/ui';

/**
 * Supplier bills on the phone: what is owed, what is late, what is due this
 * week. Read-only — payments are recorded at the till, where the cheque book is.
 */
const today = () => new Date().toLocaleDateString('en-CA');
const days = (due: string) => Math.round((new Date(due + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime()) / 864e5);
const fmt = (d?: string | null) => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';

export default function Bills() {
  const [bills, setBills] = useState<any[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pays, setPays] = useState<Record<string, any[]>>({});
  const [showPaid, setShowPaid] = useState(false);

  const run = useCallback(async () => {
    setBills(null); setError(null);
    const r = await load<any>('supplier_bills', '*', undefined, { order: 'due_date', limit: 3000 });
    if (r.error) { setError(r.error); return; }
    setMissing(r.missing);
    setBills(r.rows.filter((b) => !b.voided_at).reverse()); // soonest due first
  }, []);
  useEffect(() => { run(); }, [run]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!pays[id]) {
      const r = await loadIn<any>('supplier_payments', '*', 'bill_id', [id]);
      setPays((p) => ({ ...p, [id]: r.rows.sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on))) }));
    }
  }

  if (error) return <ErrorNote error={error} onRetry={run} />;
  if (!bills) return <Spinner label="Loading bills…" />;
  if (missing) return <Empty icon="🧾" title="Supplier bills are not on the website yet" body={SETUP_TEXT} />;

  const withBal = bills.map((b) => ({ ...b, balance: Math.max(0, Number(b.amount) - Number(b.paid)), left: b.due_date ? days(String(b.due_date).slice(0, 10)) : null }));
  const unpaid = withBal.filter((b) => b.balance > 0.005);
  const overdue = unpaid.filter((b) => b.left != null && b.left < 0);
  const week = unpaid.filter((b) => b.left != null && b.left >= 0 && b.left <= 7);
  const sum = (xs: any[]) => xs.reduce((a, b) => a + b.balance, 0);
  const list = showPaid ? withBal : unpaid;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Bills to pay</h1>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="You owe" value={lkr(sum(unpaid))} sub={`${unpaid.length} unpaid bill${unpaid.length === 1 ? '' : 's'}`} />
        <Stat label="Overdue" value={lkr(sum(overdue))} sub={overdue.length ? `${overdue.length} late` : 'Nothing late'} tone={overdue.length ? 'text-red-500' : ''} />
      </div>
      {week.length > 0 && <p className="text-sm font-semibold text-amber-600">{week.length} due in the next 7 days · {lkr(sum(week))}</p>}

      <div className="flex justify-end">
        <button onClick={() => setShowPaid(!showPaid)} className="muted text-xs font-semibold">{showPaid ? 'Hide paid bills' : 'Show paid bills too'}</button>
      </div>

      {list.length === 0 ? <Empty icon="✅" title="Nothing to pay" body="Deliveries received on credit at the till show up here with their due dates." /> : (
        <div className="space-y-2">
          {list.map((b) => (
            <div key={b.id} className="card">
              <button onClick={() => toggle(b.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{b.supplier_name || 'No supplier'}</p>
                  <p className="muted truncate text-xs">{b.invoice_no || `Bill #${b.bill_no}`} · due {fmt(b.due_date)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums">{lkr(b.balance > 0.005 ? b.balance : b.amount)}</p>
                  {b.balance <= 0.005 ? <Pill tone="ok">Paid</Pill>
                    : b.left == null ? null
                    : b.left < 0 ? <Pill tone="bad">{-b.left}d overdue</Pill>
                    : b.left === 0 ? <Pill tone="warn">Due today</Pill>
                    : <Pill tone={b.left <= 7 ? 'warn' : 'none'}>{b.left}d left</Pill>}
                </div>
              </button>
              {open === b.id && (
                <div className="border-t px-4 py-3 text-sm" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex justify-between"><span className="muted">Bill</span><span className="tabular-nums">{lkr(b.amount)}</span></div>
                  <div className="flex justify-between"><span className="muted">Paid</span><span className="tabular-nums">{lkr(b.paid)}</span></div>
                  {!pays[b.id] ? <p className="faint pt-2 text-xs">Loading…</p> : pays[b.id].map((p) => (
                    <div key={p.id} className={`flex justify-between gap-3 pt-1.5 text-xs ${p.voided_at ? 'line-through opacity-50' : ''}`}>
                      <span className="muted">{fmt(p.paid_on)} · {p.method === 'bank' ? 'bank' : p.method}{p.cheque_no ? ` #${p.cheque_no}` : ''}{p.cheque_date ? ` (dated ${fmt(p.cheque_date)})` : ''}</span>
                      <span className="tabular-nums">{lkr(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
