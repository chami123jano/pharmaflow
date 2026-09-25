import { useState, useEffect, useCallback, useRef } from 'react';
import { formatLKR } from '../lib/format';
import { useToast } from '../components/Toast';
import { useShortcuts } from '../hooks/useShortcuts';
import { ui, pill } from '../lib/ui';

type Kind = 'customers' | 'suppliers';

const BLANK = { name: '', phone: '', email: '', address: '', contact_person: '', notes: '' };

/**
 * Customers and suppliers share a screen because they are the same shape of
 * record and the same kind of work — a name, a way to reach them, and what has
 * passed between you.
 */
export default function Contacts({ user, darkMode }: { user?: any; darkMode?: boolean }) {
  const toast = useToast();
  const t = ui(darkMode);

  const [kind, setKind] = useState<Kind>('customers');
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const api: any = (window.api as any)[kind];
    const r = await api?.list?.(search);
    if (r?.ok) setRows(r.data || []);
  }, [kind, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(null); setHistory(null); }, [kind]);
  useEffect(() => { setTimeout(() => searchRef.current?.focus(), 150); }, []);
  useEffect(() => { if (editing) setTimeout(() => nameRef.current?.focus(), 60); }, [editing]);

  async function openRow(row: any) {
    setSelected(row);
    setHistory(null);
    const api: any = (window.api as any)[kind];
    const r = await api?.history?.(row.id);
    if (r?.ok) setHistory(r.data);
  }

  function startNew() { setForm(BLANK); setEditing({ id: null }); }
  function startEdit(row: any) {
    setForm({
      name: row.name || '', phone: row.phone || '', email: row.email || '',
      address: row.address || '', contact_person: row.contact_person || '', notes: row.notes || '',
    });
    setEditing(row);
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.name.trim()) { toast.error('A name is required'); return; }
    setBusy(true);
    const api: any = (window.api as any)[kind];
    const r = editing?.id ? await api.update(editing.id, form) : await api.create(form);
    setBusy(false);
    if (r?.ok) {
      toast.success(editing?.id ? 'Saved' : `${form.name} added`);
      setEditing(null);
      load();
      if (selected?.id === editing?.id) setSelected({ ...selected, ...form });
    } else {
      toast.error(r?.message || r?.error || 'Could not save');
    }
  }

  async function remove(row: any) {
    if (!confirm(`Remove ${row.name}?`)) return;
    const api: any = (window.api as any)[kind];
    const r = await api.delete(row.id);
    if (r?.ok) { toast.success('Removed'); setSelected(null); load(); }
    else toast.error(r?.message || 'Could not remove');
  }

  useShortcuts([
    { key: 'N', ctrl: true, description: 'New record', group: 'Contacts', action: startNew },
    { key: 'F', ctrl: true, description: 'Focus search', group: 'Contacts', action: () => searchRef.current?.focus() },
    { key: 'Escape', description: 'Close', group: 'Contacts', action: () => { if (editing) setEditing(null); else setSelected(null); } },
  ]);

  const isSup = kind === 'suppliers';

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${t.page}`}>People</h1>
          <p className={`text-sm mt-0.5 ${t.muted}`}>
            {rows.length} {isSup ? 'supplier' : 'customer'}{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <button onClick={startNew} className={t.btnPrimary}>
          + New {isSup ? 'supplier' : 'customer'}
        </button>
      </div>

      <div className={`${t.card} p-1.5 inline-flex gap-1`}>
        {(['customers', 'suppliers'] as Kind[]).map((k) => (
          <button key={k} onClick={() => { setKind(k); setSelected(null); setHistory(null); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition ${
              kind === k ? 'bg-blue-600 text-white shadow-sm' : `${t.muted} hover:${t.page}`
            }`}>
            {k}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className={`${t.card} overflow-hidden lg:col-span-2`}>
          <div className={`p-4 border-b ${t.border}`}>
            <input ref={searchRef} className={t.input} value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search by name, phone or email…  (Ctrl+F)`} />
          </div>

          {rows.length === 0 ? (
            <div className={`py-16 text-center ${t.muted}`}>
              <p className="text-sm">{search ? `Nothing matches "${search}".` : `No ${kind} yet.`}</p>
              {!search && <button onClick={startNew} className={`${t.btnGhost} mt-4`}>Add the first one</button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={t.th}>Name</th>
                    <th className={t.th}>Phone</th>
                    {isSup && <th className={t.th}>Contact</th>}
                    <th className={t.th}>Address</th>
                    <th className={t.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => openRow(r)}
                      className={`cursor-pointer ${t.rowHover} ${selected?.id === r.id ? t.rowActive : ''}`}>
                      <td className={`${t.td} font-semibold ${t.page}`}>{r.name}</td>
                      <td className={`${t.td} ${t.muted}`}>{r.phone || '—'}</td>
                      {isSup && <td className={`${t.td} ${t.muted}`}>{r.contact_person || '—'}</td>}
                      <td className={`${t.td} ${t.muted} max-w-xs truncate`}>{r.address || '—'}</td>
                      <td className={`${t.td} text-right whitespace-nowrap`}>
                        <button onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200">Edit</button>
                        <button onClick={(e) => { e.stopPropagation(); remove(r); }}
                          className="ml-2 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={`${t.card} p-5`}>
          {!selected ? (
            <p className={`text-sm text-center py-12 ${t.muted}`}>Choose someone to see their history.</p>
          ) : (
            <>
              <h2 className={`text-lg font-bold ${t.page}`}>{selected.name}</h2>
              <div className={`text-sm mt-1 space-y-0.5 ${t.muted}`}>
                {selected.phone && <div>{selected.phone}</div>}
                {selected.email && <div>{selected.email}</div>}
                {selected.address && <div>{selected.address}</div>}
                {selected.contact_person && <div>Contact: {selected.contact_person}</div>}
              </div>

              {history && (
                <>
                  <div className={`grid grid-cols-2 gap-3 mt-5 pt-5 border-t ${t.border}`}>
                    <div>
                      <div className={`text-[11px] uppercase tracking-wider ${t.faint}`}>{isSup ? 'Deliveries' : 'Visits'}</div>
                      <div className={`text-2xl font-bold ${t.page}`}>{(isSup ? history.deliveries : history.visits) ?? 0}</div>
                    </div>
                    <div>
                      <div className={`text-[11px] uppercase tracking-wider ${t.faint}`}>{isSup ? 'Bought' : 'Spent'}</div>
                      <div className="text-2xl font-bold text-emerald-600">
                        {formatLKR((isSup ? history.totalValue : history.totalSpent) ?? 0)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5 max-h-72 overflow-y-auto">
                    {/* The list is read defensively: a tab switch can render
                        the previous kind's history for one frame. */}
                    {((isSup ? history.batches : history.sales) || []).length === 0 ? (
                      <p className={`text-sm ${t.muted}`}>Nothing recorded yet.</p>
                    ) : isSup ? (
                      (history.batches || []).map((b: any) => (
                        <div key={b.id} className={`${t.well} px-3 py-2 text-sm flex justify-between gap-2`}>
                          <span className={`truncate ${t.page}`}>{b.product_name}</span>
                          <span className={t.muted}>
                            {b.qty_received}{b.expiry ? ` · exp ${b.expiry}` : ''}
                          </span>
                        </div>
                      ))
                    ) : (
                      (history.sales || []).map((s: any) => (
                        <div key={s.id} className={`${t.well} px-3 py-2 text-sm flex justify-between items-center gap-2`}>
                          <span className={t.page}>#{s.receipt_no}</span>
                          <span className={t.muted}>{new Date(s.created_at).toLocaleDateString('en-GB')}</span>
                          <span className={`font-semibold ${s.voided_at ? 'line-through ' + t.faint : t.page}`}>
                            {formatLKR(s.total)}
                          </span>
                          {s.voided_at && <span className={pill('out')}>void</span>}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className={t.overlay} onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <form onSubmit={save} className={`${t.modal} max-w-lg p-6`}>
            <h3 className={`text-lg font-bold mb-5 ${t.page}`}>
              {editing.id ? 'Edit' : `New ${isSup ? 'supplier' : 'customer'}`}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={t.label}>Name *</label>
                <input ref={nameRef} className={t.input} value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className={t.label}>Phone</label>
                <input className={t.input} value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="07X XXX XXXX" />
              </div>
              <div>
                <label className={t.label}>Email</label>
                <input className={t.input} value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              {isSup && (
                <div className="col-span-2">
                  <label className={t.label}>Contact person</label>
                  <input className={t.input} value={form.contact_person}
                    onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} />
                </div>
              )}
              <div className="col-span-2">
                <label className={t.label}>Address</label>
                <input className={t.input} value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className={t.label}>Notes</label>
                <input className={t.input} value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setEditing(null)} className={`flex-1 ${t.btnGhost}`}>Cancel (Esc)</button>
              <button type="submit" disabled={busy} className={`flex-1 ${t.btnPrimary}`}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
