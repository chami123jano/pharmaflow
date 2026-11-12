import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import Select from '../components/Select';
import { formatLKR } from '../lib/format';
import { ui, pill } from '../lib/ui';

/**
 * What the shop owes its suppliers.
 *
 * Every delivery makes a bill — paid at the door or on 30/45/60 days' credit —
 * and old debts can be added by hand. Soonest due first, with how many days
 * are left or how late it is. A bill can be paid in as many parts as needed;
 * it stays on the list with its balance until the last rupee is paid.
 */
const fmtDate = (d?: string | null) => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const today = () => new Date().toLocaleDateString('en-CA');

function DueChip({ b }: { b: any }) {
  if (b.status === 'paid') return <span className={pill('ok')}>Paid</span>;
  if (b.status === 'cancelled') return <span className={pill('muted')}>Cancelled</span>;
  if (b.days_left == null) return <span className={pill('muted')}>No due date</span>;
  if (b.days_left < 0) return <span className={pill('out')}>{-b.days_left} day{b.days_left === -1 ? '' : 's'} overdue</span>;
  if (b.days_left === 0) return <span className={pill('warn')}>Due today</span>;
  if (b.days_left <= 7) return <span className={pill('low')}>{b.days_left} day{b.days_left === 1 ? '' : 's'} left</span>;
  return <span className={pill('muted')}>{b.days_left} days left</span>;
}

export default function SupplierBills({ user, darkMode }: { user: any; darkMode?: boolean }) {
  const t = ui(darkMode);
  const dm = !!darkMode;
  const toast = useToast();
  const ask = useConfirm();
  const [view, setView] = useState<'unpaid' | 'paid' | 'all'>('unpaid');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [open, setOpen] = useState<any>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    const [l, s]: any[] = await Promise.all([
      (window as any).api?.bills?.list?.({ status: view, search: q }),
      (window as any).api?.bills?.summary?.(),
    ]);
    setRows(l?.ok ? l.data : []);
    if (s?.ok) setSum(s.data);
  }
  useEffect(() => { load(); }, [view, q]);

  async function openBill(id: string) {
    const r: any = await (window as any).api?.bills?.get?.(id);
    if (r?.ok) setOpen(r.data); else toast.error('Could not open the bill');
  }

  const Card = ({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) => (
    <div className={`${t.card} px-5 py-4`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${t.muted}`}>{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone || t.page}`}>{value}</p>
      <p className={`text-xs mt-0.5 ${t.muted}`}>{sub}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-2.5rem)]">
      <div className="shrink-0 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${t.page}`}>Supplier bills</h1>
          <p className={`text-sm ${t.muted}`}>What you owe for deliveries, when it is due, and what has been paid.</p>
        </div>
        <button onClick={() => setAdding(true)} className={t.btnPrimary}>+ Add a bill</button>
      </div>

      {sum && (
        <div className="shrink-0 grid grid-cols-2 xl:grid-cols-4 gap-4">
          <Card label="You owe" value={formatLKR(sum.owed)} sub={`${sum.openCount} unpaid bill${sum.openCount === 1 ? '' : 's'}`} />
          <Card label="Overdue" value={formatLKR(sum.overdue)} sub={sum.overdueCount ? `${sum.overdueCount} bill${sum.overdueCount === 1 ? '' : 's'} past the due date` : 'Nothing late'}
            tone={sum.overdue > 0 ? 'text-red-600' : undefined} />
          <Card label="Due in the next 7 days" value={formatLKR(sum.dueWeek)} sub={`${sum.dueWeekCount} bill${sum.dueWeekCount === 1 ? '' : 's'}`}
            tone={sum.dueWeek > 0 ? 'text-amber-600' : undefined} />
          <Card label="Cheques not yet due" value={formatLKR(sum.chequesPending)} sub={sum.cheques?.length
            ? `next on ${fmtDate(sum.cheques[0].cheque_date)}` : `Paid this month ${formatLKR(sum.paidThisMonth)}`} />
        </div>
      )}

      <div className={`${t.card} flex-1 min-h-0 flex flex-col overflow-hidden`}>
        <div className={`p-4 border-b ${t.border} shrink-0 flex gap-3 flex-wrap items-center`}>
          <div role="tablist" className={`flex gap-1 p-1 rounded-xl ${dm ? 'bg-slate-700/40' : 'bg-slate-100'}`}>
            {([['unpaid', 'To pay'], ['paid', 'Paid'], ['all', 'All']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold ${view === k ? 'bg-teal-700 text-white' : t.muted}`}>{l}</button>
            ))}
          </div>
          <input className={`${t.input} flex-1 min-w-[220px]`} placeholder="Search supplier or invoice no." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {!rows ? <p className={`p-8 text-center text-sm ${t.muted}`}>Loading…</p>
            : rows.length === 0 ? (
              <div className={`h-full grid place-items-center p-8 text-center ${t.muted}`}>
                <div>
                  <p className={`font-semibold ${t.page}`}>{view === 'unpaid' ? 'Nothing to pay' : 'No bills here'}</p>
                  <p className="text-sm mt-1">Deliveries received on credit appear here with their due dates. Old debts can be added with "+ Add a bill".</p>
                </div>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10"><tr>
                  <th className={t.th}>Supplier</th><th className={t.th}>Invoice</th><th className={t.th}>Bill date</th>
                  <th className={`${t.th} text-right`}>Amount</th><th className={`${t.th} text-right`}>Paid</th>
                  <th className={`${t.th} text-right`}>Left to pay</th><th className={t.th}>Due</th><th className={t.th}></th>
                </tr></thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className={`cursor-pointer ${t.rowHover}`} onClick={() => openBill(b.id)}>
                      <td className={`${t.td} font-medium ${t.page}`}>{b.supplier_name || 'No supplier'}</td>
                      <td className={`${t.td} ${t.muted}`}>{b.invoice_no || `Bill #${b.bill_no}`}</td>
                      <td className={`${t.td} ${t.muted}`}>{fmtDate(b.invoice_date)}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{formatLKR(b.amount)}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.muted}`}>{Number(b.paid) > 0 ? formatLKR(b.paid) : '—'}</td>
                      <td className={`${t.td} text-right tabular-nums font-semibold ${t.page}`}>{formatLKR(b.balance)}</td>
                      <td className={t.td}><div className="flex flex-col gap-0.5"><DueChip b={b} /><span className={`text-[11px] ${t.faint}`}>{fmtDate(b.due_date)}</span></div></td>
                      <td className={`${t.td} text-right`}>
                        {b.balance > 0.005 && b.status !== 'cancelled' && (
                          <button onClick={(e) => { e.stopPropagation(); openBill(b.id); }} className={`${t.btnPrimary} !py-1.5 !px-3`}>Pay</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>

      {open && <BillDialog bill={open} user={user} darkMode={dm} ask={ask} toast={toast}
        onClose={() => setOpen(null)} onChanged={async () => { await load(); await openBill(open.id); }} />}
      {adding && <AddBill user={user} darkMode={dm} toast={toast} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function BillDialog({ bill, user, darkMode, onClose, onChanged, ask, toast }: any) {
  const t = ui(darkMode);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'cheque' | 'bank'>('cash');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setAmount(bill.balance > 0 ? String(bill.balance) : ''); }, [bill.id, bill.balance]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  const amt = Number(amount || 0);
  const after = Math.max(0, Math.round((bill.balance - amt) * 100) / 100);

  async function pay() {
    setBusy(true);
    try {
      const r: any = await (window as any).api?.bills?.pay?.({
        bill_id: bill.id, amount: amt, method, cheque_no: chequeNo, cheque_date: chequeDate || null,
        paid_on: paidOn, notes: note, user_id: user?.id,
      });
      if (!r?.ok) { toast.error(r?.message || 'Could not record the payment'); return; }
      toast.success(r.data.bill.balance > 0.005 ? `${formatLKR(amt)} paid — ${formatLKR(r.data.bill.balance)} still to pay` : 'Bill fully paid');
      setChequeNo(''); setChequeDate(''); setNote('');
      onChanged();
    } finally { setBusy(false); }
  }

  async function undo(p: any) {
    if (!(await ask({ title: `Undo the ${formatLKR(p.amount)} payment?`, message: 'It stays in the history, crossed out, and the amount goes back onto the bill.', confirmLabel: 'Undo payment', tone: 'danger' }))) return;
    const r: any = await (window as any).api?.bills?.voidPayment?.(p.id, user?.id);
    if (r?.ok) { toast.info('Payment undone'); onChanged(); } else toast.error(r?.message || 'Could not undo');
  }

  async function cancelBill() {
    if (!(await ask({ title: 'Cancel this bill?', message: 'Use this only for a bill added by mistake.', confirmLabel: 'Cancel bill', cancelLabel: 'Keep it', tone: 'danger' }))) return;
    const r: any = await (window as any).api?.bills?.void?.(bill.id, user?.id, '');
    if (r?.ok) { toast.info('Bill cancelled'); onChanged(); } else toast.error(r?.message || 'Could not cancel');
  }

  return (
    <div className={t.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${t.modal} max-w-3xl max-h-[92vh] flex flex-col`} role="dialog" aria-modal="true" aria-label="Supplier bill">
        <div className={`p-5 border-b ${t.border} flex items-start justify-between gap-4`}>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className={`text-xl font-bold ${t.page}`}>{bill.supplier_name || 'No supplier'}</h2>
              <DueChip b={bill} />
            </div>
            <p className={`text-sm mt-1 ${t.muted}`}>
              {bill.invoice_no ? `Invoice ${bill.invoice_no}` : `Bill #${bill.bill_no}`}
              {bill.grn_no ? ` · GRN-${String(bill.grn_no).padStart(4, '0')}` : ' · added by hand'}
              {' · '}billed {fmtDate(bill.invoice_date)}
              {bill.credit_days ? ` · ${bill.credit_days} days' credit` : ''} · due {fmtDate(bill.due_date)}
            </p>
          </div>
          <button onClick={onClose} className={`${t.btnGhost} px-3`} aria-label="Close">✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-5 space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {[['Bill amount', bill.amount, t.page], ['Paid so far', bill.paid, 'text-lime-700'], ['Left to pay', bill.balance, bill.balance > 0.005 ? 'text-red-600' : 'text-lime-700']].map(([l, v, c]: any) => (
              <div key={l} className={`${t.well} px-4 py-3`}>
                <p className={`text-[11px] font-semibold uppercase tracking-wider ${t.muted}`}>{l}</p>
                <p className={`text-xl font-bold tabular-nums ${c}`}>{formatLKR(v)}</p>
              </div>
            ))}
          </div>

          <div>
            <h3 className={`text-[11px] font-semibold uppercase tracking-wider mb-2 ${t.muted}`}>Payments</h3>
            {bill.payments.length === 0 ? <p className={`text-sm ${t.muted}`}>Nothing paid yet.</p> : (
              <table className="w-full text-sm">
                <tbody>
                  {bill.payments.map((p: any) => (
                    <tr key={p.id} className={p.voided_at ? 'opacity-50' : ''}>
                      <td className={`${t.td} ${t.page}`}>{fmtDate(p.paid_on)}</td>
                      <td className={`${t.td} ${t.muted} capitalize`}>
                        {p.method === 'bank' ? 'Bank transfer' : p.method}{p.cheque_no ? ` #${p.cheque_no}` : ''}
                        {p.cheque_date ? ` · cheque date ${fmtDate(p.cheque_date)}` : ''}
                        {p.source === 'grn' ? ' · at delivery' : ''}
                        {p.notes ? <span className="block text-xs normal-case">{p.notes}</span> : null}
                      </td>
                      <td className={`${t.td} ${t.muted}`}>{p.created_by_name || ''}</td>
                      <td className={`${t.td} text-right tabular-nums font-semibold ${p.voided_at ? 'line-through' : t.page}`}>{formatLKR(p.amount)}</td>
                      <td className={`${t.td} text-right`}>
                        {p.voided_at ? <span className={pill('muted')}>undone</span>
                          : user?.role === 'admin' && <button onClick={() => undo(p)} className="text-xs text-red-600 hover:underline">Undo</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {bill.balance > 0.005 && bill.status !== 'cancelled' && (
            user?.role !== 'admin' ? <p className={`text-sm ${t.muted}`}>An admin records payments.</p> : (
              <div className={`${t.well} p-4 space-y-3`}>
                <h3 className={`font-semibold ${t.page}`}>Record a payment</h3>
                <div className="flex gap-2 items-center flex-wrap">
                  <div className="relative">
                    <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${t.muted}`}>Rs.</span>
                    <input inputMode="decimal" aria-label="Amount paid" className={`${t.input} !pl-10 w-44 text-lg font-semibold tabular-nums`}
                      value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
                  </div>
                  <button type="button" onClick={() => setAmount(String(Math.round(bill.balance * 50) / 100))} className={t.btnGhost}>Half</button>
                  <button type="button" onClick={() => setAmount(String(bill.balance))} className={t.btnGhost}>All of it</button>
                  {amt > 0 && amt < bill.balance && <span className={`text-sm ${t.muted}`}>leaves <b className={t.page}>{formatLKR(after)}</b> to pay later</span>}
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  {(['cash', 'cheque', 'bank'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setMethod(m)}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-semibold ${method === m ? 'bg-teal-700 border-teal-700 text-white' : `${t.border} ${t.muted}`}`}>
                      {m === 'bank' ? 'Bank transfer' : m === 'cheque' ? 'Cheque' : 'Cash'}</button>
                  ))}
                  {method === 'cheque' && (
                    <>
                      <input aria-label="Cheque number" placeholder="Cheque no." className={`${t.input} !w-36`} value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
                      <label className={`text-xs ${t.muted}`}>Cheque date</label>
                      <input aria-label="Cheque date" type="date" className={`${t.input} !w-44`} value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
                    </>
                  )}
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <label className={`text-xs ${t.muted}`}>Paid on</label>
                  <input type="date" aria-label="Paid on" className={`${t.input} !w-44`} value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
                  <input className={`${t.input} flex-1 min-w-[180px]`} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button onClick={pay} disabled={busy || !(amt > 0) || amt > bill.balance + 0.005} className={`${t.btnPrimary} px-6`}>{busy ? 'Saving…' : 'Save payment'}</button>
                </div>
                {amt > bill.balance + 0.005 && <p className="text-sm text-red-600">That is more than the {formatLKR(bill.balance)} left on this bill.</p>}
              </div>
            )
          )}
          {bill.notes && <p className={`text-sm ${t.muted}`}>Note: {bill.notes}</p>}
        </div>
        {!bill.grn_id && bill.status !== 'cancelled' && Number(bill.paid) <= 0.005 && user?.role === 'admin' && (
          <div className={`px-5 py-3 border-t ${t.border}`}>
            <button onClick={cancelBill} className="text-sm text-red-600 hover:underline">Cancel this bill</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddBill({ user, darkMode, onClose, onSaved, toast }: any) {
  const t = ui(darkMode);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [f, setF] = useState({ supplier_id: '', invoice_no: '', invoice_date: today(), amount: '', days: '30', notes: '' });
  useEffect(() => { (async () => { const r: any = await (window as any).api?.suppliers?.list?.(); setSuppliers(r?.ok ? r.data : []); })(); }, []);
  const due = useMemo(() => {
    const d = new Date((f.invoice_date || today()) + 'T00:00:00'); d.setDate(d.getDate() + Number(f.days || 0));
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }, [f.invoice_date, f.days]);

  async function save() {
    const r: any = await (window as any).api?.bills?.create?.({
      supplier_id: f.supplier_id, invoice_no: f.invoice_no, invoice_date: f.invoice_date, amount: Number(f.amount),
      credit_days: Number(f.days || 0), notes: f.notes, user_id: user?.id,
    });
    if (r?.ok) { toast.success('Bill added'); onSaved(); } else toast.error(r?.message || 'Could not add the bill');
  }

  return (
    <div className={t.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${t.modal} max-w-lg p-6`} role="dialog" aria-modal="true" aria-label="Add a bill">
        <h2 className={`text-lg font-bold ${t.page}`}>Add a bill</h2>
        <p className={`text-sm mt-0.5 mb-4 ${t.muted}`}>For money owed that did not come through Receive stock — debts from before the app, for example.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={t.label}>Supplier</label>
            <Select aria-label="Supplier" value={f.supplier_id} placeholder="Choose supplier…" searchable
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              onChange={(v) => { const s = suppliers.find((x) => x.id === v); setF({ ...f, supplier_id: v, days: s?.credit_days ? String(s.credit_days) : f.days }); }} /></div>
          <div><label className={t.label}>Invoice no.</label><input className={t.input} value={f.invoice_no} onChange={(e) => setF({ ...f, invoice_no: e.target.value })} /></div>
          <div><label className={t.label}>Invoice date</label><input type="date" className={t.input} value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} /></div>
          <div><label className={t.label}>Amount owed (Rs)</label><input inputMode="decimal" className={`${t.input} tabular-nums`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          <div><label className={t.label}>Credit days</label><input inputMode="numeric" className={t.input} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value.replace(/\D/g, '') })} /></div>
          <p className={`col-span-2 text-sm ${t.muted}`}>Due <b className={t.page}>{due}</b></p>
          <div className="col-span-2"><input className={t.input} placeholder="Note (optional)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className={t.btnGhost}>Cancel</button>
          <button onClick={save} disabled={!f.supplier_id || !(Number(f.amount) > 0)} className={t.btnPrimary}>Add bill</button>
        </div>
      </div>
    </div>
  );
}
