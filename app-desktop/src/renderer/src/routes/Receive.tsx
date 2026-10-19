import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import Select from '../components/Select';
import { useShop } from '../lib/shop';
import { formatLKR } from '../lib/format';
import { grnA4HTML, grnRollHTML, grnNo } from '../lib/grnDoc';
import { ui, pill } from '../lib/ui';

/**
 * Goods received — taking in a supplier's delivery as one note.
 *
 * The cashier works down the supplier's invoice: find the item, type the
 * quantity, batch, expiry and cost, next item. Every line goes on the shelf
 * together when the note is saved, or none does. The unsaved note is kept if
 * someone leaves the page to serve a customer.
 */

interface Line {
  key: string;
  product_id: string;
  name: string;
  sku?: string;
  stock?: number;
  batch_no: string;
  expiry: string;
  qty: string;
  free_qty: string;
  cost: string;
}

interface Draft {
  supplier_id: string;
  invoice_no: string;
  invoice_date: string;
  invoice_total: string;
  notes: string;
  lines: Line[];
}

const EMPTY: Draft = { supplier_id: '', invoice_no: '', invoice_date: '', invoice_total: '', notes: '', lines: [] };
const DRAFT_KEY = 'grnDraft';
const NEW_SUPPLIER = '__new__';

function loadDraft(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d && Array.isArray(d.lines)) return { ...EMPTY, ...d };
  } catch {}
  return EMPTY;
}

const num = (s: string) => (s.trim() === '' ? 0 : Number(s));
const lineAmount = (l: Line) => (l.cost.trim() === '' ? 0 : Math.round(num(l.qty) * num(l.cost) * 100) / 100);
const today = () => new Date().toISOString().slice(0, 10);
const daysUntil = (d: string) => Math.round((new Date(d + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime()) / 86400000);

export default function Receive({ user, darkMode }: { user?: any; darkMode?: boolean }) {
  const t = ui(darkMode);
  const dm = !!darkMode;
  const toast = useToast();
  const ask = useConfirm();
  const shop = useShop();

  const [view, setView] = useState<'new' | 'past'>('new');
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [products, setProducts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState(0);
  const [saving, setSaving] = useState(false);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState('');
  const [past, setPast] = useState<any[]>([]);
  const [pastQuery, setPastQuery] = useState('');
  const [open, setOpen] = useState<any>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {} }, [draft]);

  async function loadProducts() {
    const r: any = await (window as any).api?.products?.list?.();
    if (r?.ok) setProducts(r.data || []);
  }
  async function loadSuppliers() {
    const r: any = await (window as any).api?.suppliers?.list?.();
    if (r?.ok) setSuppliers(r.data || []);
    return r?.ok ? (r.data || []) : [];
  }
  async function loadPast() {
    const r: any = await (window as any).api?.grn?.list?.({ search: pastQuery });
    if (r?.ok) setPast(r.data || []);
  }

  useEffect(() => { loadProducts(); loadSuppliers(); }, []);
  useEffect(() => { if (view === 'past') loadPast(); }, [view, pastQuery]);
  useEffect(() => { if (view === 'new') setTimeout(() => searchRef.current?.focus(), 50); }, [view]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) =>
      p.name?.toLowerCase().includes(q) || p.generic_name?.toLowerCase().includes(q)
      || p.sku?.toLowerCase().includes(q) || (p.barcode && String(p.barcode) === query.trim())
    ).slice(0, 8);
  }, [products, query]);
  useEffect(() => setHit(0), [query]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setLine = (key: string, patch: Partial<Line>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key: string) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== key) }));

  async function addProduct(p: any) {
    const key = Math.random().toString(36).slice(2);
    // Last price paid, as a starting point — it is usually the same.
    let cost = '';
    try {
      const r: any = await (window as any).api?.batches?.list?.(p.id);
      const last = (r?.data || []).filter((b: any) => b.cost_price != null)
        .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      if (last) cost = String(last.cost_price);
    } catch {}
    setDraft((d) => ({ ...d, lines: [...d.lines, {
      key, product_id: p.id, name: p.name, sku: p.sku, stock: p.stock,
      batch_no: '', expiry: '', qty: '', free_qty: '', cost,
    }] }));
    setQuery('');
    // Straight into the new line's quantity, the next thing on the invoice.
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-line="${key}"][data-f="qty"]`);
      el?.focus();
      el?.scrollIntoView({ block: 'nearest' });
    }, 30);
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHit((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHit((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && matches[hit]) { e.preventDefault(); addProduct(matches[hit]); }
    else if (e.key === 'Escape') setQuery('');
  }

  // Enter in a line moves along it; at the end it goes back to search for the
  // next item, so a whole invoice can be keyed without touching the mouse.
  const FIELDS = ['qty', 'free', 'cost', 'batch', 'expiry'];
  function onLineKey(e: React.KeyboardEvent, key: string, field: string) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const i = FIELDS.indexOf(field);
    const next = FIELDS[i + 1];
    if (next) document.querySelector<HTMLInputElement>(`[data-line="${key}"][data-f="${next}"]`)?.focus();
    else searchRef.current?.focus();
  }

  const totals = useMemo(() => {
    let cost = 0, units = 0;
    for (const l of draft.lines) { cost += lineAmount(l); units += num(l.qty) + num(l.free_qty); }
    return { cost: Math.round(cost * 100) / 100, units };
  }, [draft.lines]);

  const invoiceTotal = draft.invoice_total.trim() === '' ? null : Number(draft.invoice_total);
  const diff = invoiceTotal != null && Number.isFinite(invoiceTotal) ? Math.round((invoiceTotal - totals.cost) * 100) / 100 : null;

  function lineProblem(l: Line): string | null {
    const q = num(l.qty), f = num(l.free_qty);
    if (!Number.isInteger(q) || !Number.isInteger(f) || q < 0 || f < 0) return 'Whole numbers only';
    if (q + f <= 0) return 'Enter a quantity';
    if (l.cost.trim() !== '' && (!Number.isFinite(Number(l.cost)) || Number(l.cost) < 0)) return 'Cost is not a number';
    return null;
  }

  async function save(allowDuplicate = false) {
    if (!draft.lines.length) { toast.error('Add at least one item'); searchRef.current?.focus(); return; }
    const bad = draft.lines.findIndex((l) => lineProblem(l));
    if (bad >= 0) {
      toast.error(`Line ${bad + 1}: ${lineProblem(draft.lines[bad])}`);
      document.querySelector<HTMLInputElement>(`[data-line="${draft.lines[bad].key}"][data-f="qty"]`)?.focus();
      return;
    }
    const expired = draft.lines.filter((l) => l.expiry && daysUntil(l.expiry) < 0);
    if (expired.length && !allowDuplicate) {
      const goOn = await ask({
        title: `${expired.length === 1 ? expired[0].name + ' is' : expired.length + ' items are'} already expired`,
        message: 'Expired stock cannot be sold by cashiers. Check the dates against the boxes. Save anyway?',
        confirmLabel: 'Save anyway',
      });
      if (!goOn) return;
    }
    if (!draft.supplier_id) {
      const goOn = await ask({
        title: 'No supplier chosen',
        message: 'The GRN will be saved without a supplier, and will not show in any supplier’s history.',
        confirmLabel: 'Save without supplier',
      });
      if (!goOn) return;
    }

    setSaving(true);
    try {
      const r: any = await (window as any).api?.grn?.create?.({
        supplier_id: draft.supplier_id || null,
        invoice_no: draft.invoice_no,
        invoice_date: draft.invoice_date || null,
        invoice_total: invoiceTotal,
        notes: draft.notes,
        created_by: user?.id,
        allow_duplicate_invoice: allowDuplicate,
        items: draft.lines.map((l) => ({
          product_id: l.product_id, qty: num(l.qty), free_qty: num(l.free_qty),
          cost_price: l.cost.trim() === '' ? null : Number(l.cost),
          batch_no: l.batch_no, expiry: l.expiry || null,
        })),
      });
      if (r?.ok) {
        toast.success(`${grnNo(r.data.grn_no)} saved — ${r.data.unit_count} units on the shelf`);
        setDraft(EMPTY);
        loadProducts();
        window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'products' } }));
        openGrn(r.data.id);
      } else if (r?.error === 'DUPLICATE_INVOICE') {
        setSaving(false);
        if (await ask({ title: 'This invoice was already received', message: r.message + '. Save it again?', confirmLabel: 'Save again' })) {
          return save(true);
        }
      } else {
        toast.error(r?.message || r?.error || 'Could not save');
      }
    } finally {
      setSaving(false);
    }
  }

  async function clearDraft() {
    if (draft.lines.length && !(await ask({ title: 'Clear this GRN?', message: 'Every line typed so far is removed. Nothing has been saved yet.', confirmLabel: 'Clear', tone: 'danger' }))) return;
    setDraft(EMPTY);
    searchRef.current?.focus();
  }

  async function addSupplier() {
    const name = newSupplier.trim();
    if (!name) return;
    const r: any = await (window as any).api?.suppliers?.create?.({ name });
    if (!r?.ok) { toast.error(r?.message || 'Could not add supplier'); return; }
    await loadSuppliers();
    set({ supplier_id: r.data?.id || '' });
    setAddingSupplier(false);
    setNewSupplier('');
    toast.success(`${name} added to suppliers`);
  }

  async function openGrn(id: string) {
    const r: any = await (window as any).api?.grn?.get?.(id);
    if (r?.ok) setOpen(r.data);
    else toast.error('Could not open that GRN');
  }

  async function printRoll(g: any) {
    const r: any = await (window as any).api?.util?.printHTML?.(grnRollHTML(g, shop));
    if (r?.ok) toast.success('Sent to the printer');
    else if (r?.error !== 'CANCELLED') toast.error(r?.message || 'Could not print');
  }

  async function savePdf(g: any) {
    const r: any = await (window as any).api?.util?.saveDocumentPDF?.(grnA4HTML(g, shop), grnNo(g.grn_no), 'GRNs', true);
    if (r?.ok) toast.success('Saved to ' + r.data.path);
    else toast.error(r?.message || 'Could not save the PDF');
  }

  async function voidGrn(g: any) {
    if (!(await ask({
      title: `Cancel ${grnNo(g.grn_no)}?`,
      message: `Its ${g.unit_count} units come back off the shelf. Use this only for a note entered by mistake.`,
      confirmLabel: 'Cancel GRN', cancelLabel: 'Keep it', tone: 'danger',
    }))) return;
    const r: any = await (window as any).api?.grn?.void?.(g.id, user?.id, '');
    if (r?.ok) {
      toast.success(`${grnNo(g.grn_no)} cancelled`);
      window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'products' } }));
      loadProducts(); loadPast(); openGrn(g.id);
    } else toast.error(r?.message || 'Could not cancel');
  }

  // Ctrl+Enter saves from anywhere on the note (Ctrl+S is already "go to Sales").
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (view === 'new' && !open && e.ctrlKey && e.key === 'Enter') { e.preventDefault(); save(); }
      if (open && e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const supplierOptions = [
    ...suppliers.map((s) => ({ value: s.id, label: s.name, hint: s.phone || undefined })),
    { value: NEW_SUPPLIER, label: '+ Add a new supplier', group: ' ' },
  ];

  const cell = `w-full px-2.5 py-1.5 rounded-lg border text-sm tabular-nums focus:outline-none focus:ring-2 transition ${
    dm ? 'bg-slate-700/60 border-slate-600 text-slate-100 focus:ring-teal-500/40 focus:border-teal-500'
       : 'bg-white border-slate-300 text-slate-900 focus:ring-teal-600/25 focus:border-teal-600'}`;

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-2.5rem)]">
      {/* Title and the two views */}
      <div className="shrink-0 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${t.page}`}>Goods received</h1>
          <p className={`text-sm ${t.muted}`}>Enter a supplier's delivery as one note. Everything goes on the shelf together.</p>
        </div>
        <div role="tablist" className={`flex gap-1 p-1.5 ${t.card}`}>
          {([['new', 'New GRN'], ['past', 'Past GRNs']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                view === k ? 'bg-teal-700 text-white shadow-sm'
                  : `${t.muted} ${dm ? 'hover:text-slate-100 hover:bg-slate-700/50' : 'hover:text-slate-900 hover:bg-slate-100'}`}`}>
              {label}{k === 'new' && draft.lines.length ? ` (${draft.lines.length})` : ''}
            </button>
          ))}
        </div>
      </div>

      {view === 'new' ? (
        <>
          {/* Who it came from */}
          <div className={`${t.card} p-4 shrink-0 grid grid-cols-2 xl:grid-cols-4 gap-3`}>
            <div>
              <label className={t.label}>Supplier</label>
              {addingSupplier ? (
                <div className="flex gap-2">
                  <input autoFocus className={t.input} placeholder="Supplier name" value={newSupplier}
                    onChange={(e) => setNewSupplier(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addSupplier(); if (e.key === 'Escape') setAddingSupplier(false); }} />
                  <button onClick={addSupplier} className={`${t.btnPrimary} shrink-0`}>Add</button>
                  <button onClick={() => setAddingSupplier(false)} className={`${t.btnGhost} shrink-0 px-3`} aria-label="Cancel">✕</button>
                </div>
              ) : (
                <Select aria-label="Supplier" value={draft.supplier_id} placeholder="Choose supplier…" searchable
                  options={supplierOptions}
                  onChange={(v) => { if (v === NEW_SUPPLIER) setAddingSupplier(true); else set({ supplier_id: v }); }} />
              )}
            </div>
            <div>
              <label className={t.label}>Supplier invoice no.</label>
              <input className={t.input} value={draft.invoice_no} placeholder="e.g. INV-20431"
                onChange={(e) => set({ invoice_no: e.target.value })} />
            </div>
            <div>
              <label className={t.label}>Invoice date</label>
              <input type="date" className={t.input} value={draft.invoice_date} max={today()}
                onChange={(e) => set({ invoice_date: e.target.value })} />
            </div>
            <div>
              <label className={t.label}>Invoice total (Rs) <span className="normal-case font-normal tracking-normal">— to check against</span></label>
              <input inputMode="decimal" className={`${t.input} tabular-nums`} value={draft.invoice_total} placeholder="Optional"
                onChange={(e) => set({ invoice_total: e.target.value.replace(/[^\d.]/g, '') })} />
            </div>
          </div>

          {/* The lines */}
          <div className={`${t.card} flex-1 min-h-0 flex flex-col overflow-hidden`}>
            <div className={`p-4 border-b ${t.border} shrink-0 relative`}>
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
                placeholder="Find an item to add — name, generic name, SKU or scan barcode"
                className={`${t.input} text-base py-3`} />
              {matches.length > 0 && (
                <div className={`absolute left-4 right-4 top-full -mt-2 z-20 rounded-xl border shadow-raised overflow-hidden ${
                  dm ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                  {matches.map((p, i) => (
                    <button key={p.id} onMouseDown={(e) => { e.preventDefault(); addProduct(p); }} onMouseEnter={() => setHit(i)}
                      className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 ${
                        i === hit ? (dm ? 'bg-teal-900/40' : 'bg-teal-50') : ''}`}>
                      <span className="min-w-0">
                        <span className={`block truncate font-medium ${t.page}`}>{p.name}</span>
                        <span className={`block text-xs truncate ${t.muted}`}>{[p.generic_name, p.sku].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className={`shrink-0 text-xs ${t.muted}`}>in stock {p.stock ?? 0}</span>
                    </button>
                  ))}
                </div>
              )}
              {query.trim() && matches.length === 0 && (
                <p className={`mt-2 text-sm ${t.muted}`}>No item called “{query}”. Add it in Inventory first, then come back — this note is kept.</p>
              )}
            </div>

            <div ref={tableRef} className="flex-1 min-h-0 overflow-auto">
              {draft.lines.length === 0 ? (
                <div className={`h-full grid place-items-center text-center p-8 ${t.muted}`}>
                  <div>
                    <p className={`font-medium ${t.page}`}>No items yet</p>
                    <p className="text-sm mt-1">Work down the supplier's invoice: find an item, press Enter, type the quantity.</p>
                    <p className="text-sm mt-1">Enter moves along the line; at the end it comes back here for the next item.</p>
                  </div>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className={`${t.th} w-8`}>#</th>
                      <th className={t.th}>Item</th>
                      <th className={`${t.th} w-24 text-right`}>Qty</th>
                      <th className={`${t.th} w-20 text-right`}>Free</th>
                      <th className={`${t.th} w-28 text-right`}>Unit cost</th>
                      <th className={`${t.th} w-32`}>Batch no.</th>
                      <th className={`${t.th} w-40`}>Expiry</th>
                      <th className={`${t.th} w-32 text-right`}>Amount</th>
                      <th className={`${t.th} w-10`}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.map((l, i) => {
                      const problem = (l.qty || l.free_qty) ? lineProblem(l) : null;
                      const d = l.expiry ? daysUntil(l.expiry) : null;
                      return (
                        <tr key={l.key} className={t.rowHover}>
                          <td className={`${t.td} ${t.muted}`}>{i + 1}</td>
                          <td className={t.td}>
                            <div className={`font-medium ${t.page}`}>{l.name}</div>
                            <div className={`text-xs ${t.muted}`}>{[l.sku, l.stock != null ? `${l.stock} in stock now` : ''].filter(Boolean).join(' · ')}</div>
                            {problem && <div className="text-xs text-red-600 mt-0.5">{problem}</div>}
                          </td>
                          <td className={t.td}>
                            <input data-line={l.key} data-f="qty" inputMode="numeric" className={`${cell} text-right`} value={l.qty}
                              onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/\D/g, '') })} onKeyDown={(e) => onLineKey(e, l.key, 'qty')} />
                          </td>
                          <td className={t.td}>
                            <input data-line={l.key} data-f="free" inputMode="numeric" className={`${cell} text-right`} value={l.free_qty} placeholder="0"
                              onChange={(e) => setLine(l.key, { free_qty: e.target.value.replace(/\D/g, '') })} onKeyDown={(e) => onLineKey(e, l.key, 'free')} />
                          </td>
                          <td className={t.td}>
                            <input data-line={l.key} data-f="cost" inputMode="decimal" className={`${cell} text-right`} value={l.cost} placeholder="0.00"
                              onChange={(e) => setLine(l.key, { cost: e.target.value.replace(/[^\d.]/g, '') })} onKeyDown={(e) => onLineKey(e, l.key, 'cost')} />
                          </td>
                          <td className={t.td}>
                            <input data-line={l.key} data-f="batch" className={cell} value={l.batch_no} placeholder="Optional"
                              onChange={(e) => setLine(l.key, { batch_no: e.target.value })} onKeyDown={(e) => onLineKey(e, l.key, 'batch')} />
                          </td>
                          <td className={t.td}>
                            <input data-line={l.key} data-f="expiry" type="date" className={cell} value={l.expiry}
                              onChange={(e) => setLine(l.key, { expiry: e.target.value })} onKeyDown={(e) => onLineKey(e, l.key, 'expiry')} />
                            {d != null && d < 0 && <div className="text-xs text-red-600 mt-0.5">Already expired</div>}
                            {d != null && d >= 0 && d < 90 && <div className="text-xs text-amber-600 mt-0.5">Short date — {d} days</div>}
                          </td>
                          <td className={`${t.td} text-right font-semibold tabular-nums ${t.page}`}>{formatLKR(lineAmount(l))}</td>
                          <td className={t.td}>
                            <button onClick={() => removeLine(l.key)} aria-label={`Remove ${l.name}`}
                              className={`w-8 h-8 rounded-lg grid place-items-center ${dm ? 'text-slate-400 hover:bg-red-900/40 hover:text-red-300' : 'text-slate-400 hover:bg-red-50 hover:text-red-600'}`}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Totals and save */}
            <div className={`shrink-0 border-t ${t.border} p-4 flex items-center gap-4 flex-wrap`}>
              <input className={`${t.input} flex-1 min-w-[220px]`} placeholder="Notes (optional) — e.g. 2 boxes damaged, credit note asked for"
                value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
              <div className="flex items-center gap-5 tabular-nums">
                <div className="text-right">
                  <div className={`text-[11px] uppercase tracking-wider font-semibold ${t.muted}`}>Lines · units</div>
                  <div className={`font-semibold ${t.page}`}>{draft.lines.length} · {totals.units}</div>
                </div>
                <div className="text-right">
                  <div className={`text-[11px] uppercase tracking-wider font-semibold ${t.muted}`}>Total cost</div>
                  <div className={`text-xl font-bold ${t.page}`}>{formatLKR(totals.cost)}</div>
                </div>
                {diff != null && (
                  <span className={pill(Math.abs(diff) < 0.005 ? 'ok' : 'warn')}>
                    {Math.abs(diff) < 0.005 ? 'Matches invoice' : `Invoice is ${formatLKR(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'}`}
                  </span>
                )}
              </div>
              <div className="flex gap-2 ml-auto">
                <button onClick={clearDraft} className={t.btnGhost}>Clear</button>
                <button onClick={() => save()} disabled={saving || !draft.lines.length} className={`${t.btnPrimary} px-6`}>
                  {saving ? 'Saving…' : 'Save GRN'} <kbd className="text-[10px] font-medium opacity-80 ml-1">Ctrl+Enter</kbd>
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className={`${t.card} flex-1 min-h-0 flex flex-col overflow-hidden`}>
          <div className={`p-4 border-b ${t.border} shrink-0`}>
            <input className={t.input} placeholder="Search by supplier, invoice no., GRN no. or item…" value={pastQuery}
              onChange={(e) => setPastQuery(e.target.value)} />
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {past.length === 0 ? (
              <div className={`h-full grid place-items-center p-8 text-sm ${t.muted}`}>
                {pastQuery ? 'Nothing matches.' : 'No GRNs yet. Saved notes appear here.'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={t.th}>GRN</th><th className={t.th}>Received</th><th className={t.th}>Supplier</th>
                    <th className={t.th}>Invoice</th><th className={`${t.th} text-right`}>Lines</th>
                    <th className={`${t.th} text-right`}>Units</th><th className={`${t.th} text-right`}>Total cost</th><th className={t.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((g) => (
                    <tr key={g.id} onClick={() => openGrn(g.id)} className={`cursor-pointer ${t.rowHover} ${g.voided_at ? 'opacity-60' : ''}`}>
                      <td className={`${t.td} font-semibold ${t.page}`}>{grnNo(g.grn_no)}</td>
                      <td className={`${t.td} ${t.muted}`}>{new Date(g.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className={`${t.td} ${t.page}`}>{g.supplier_name || '—'}</td>
                      <td className={`${t.td} ${t.muted}`}>{g.invoice_no || '—'}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{g.line_count}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{g.unit_count}</td>
                      <td className={`${t.td} text-right tabular-nums font-semibold ${g.voided_at ? 'line-through ' + t.muted : t.page}`}>{formatLKR(g.total_cost)}</td>
                      <td className={t.td}>{g.voided_at ? <span className={pill('out')}>Cancelled</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* One note, opened */}
      {open && (
        <div className={t.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className={`${t.modal} max-w-4xl max-h-[90vh] flex flex-col`} role="dialog" aria-modal="true" aria-label={grnNo(open.grn_no)}>
            <div className={`p-5 border-b ${t.border} flex items-start justify-between gap-4`}>
              <div>
                <div className="flex items-center gap-3">
                  <h2 className={`text-xl font-bold ${t.page}`}>{grnNo(open.grn_no)}</h2>
                  {open.voided_at && <span className={pill('out')}>Cancelled</span>}
                </div>
                <p className={`text-sm mt-1 ${t.muted}`}>
                  {open.supplier_name || 'No supplier'}{open.invoice_no ? ` · invoice ${open.invoice_no}` : ''}
                  {' · received '}{new Date(open.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {open.created_by_name ? ` by ${open.created_by_name}` : ''}
                </p>
              </div>
              <button onClick={() => setOpen(null)} className={`${t.btnGhost} px-3`} aria-label="Close">✕</button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr>
                    <th className={t.th}>Item</th><th className={t.th}>Batch</th><th className={t.th}>Expiry</th>
                    <th className={`${t.th} text-right`}>Qty</th><th className={`${t.th} text-right`}>Free</th>
                    <th className={`${t.th} text-right`}>Unit cost</th><th className={`${t.th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(open.items || []).map((it: any) => (
                    <tr key={it.id}>
                      <td className={`${t.td} ${t.page}`}>{it.product_name}</td>
                      <td className={`${t.td} ${t.muted}`}>{it.batch_no || '—'}</td>
                      <td className={`${t.td} ${t.muted}`}>{it.expiry || '—'}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{it.qty}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.muted}`}>{it.free_qty || '—'}</td>
                      <td className={`${t.td} text-right tabular-nums ${t.page}`}>{it.cost_price != null ? formatLKR(it.cost_price) : '—'}</td>
                      <td className={`${t.td} text-right tabular-nums font-semibold ${t.page}`}>{formatLKR(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {open.notes && <p className={`px-5 py-3 text-sm ${t.muted}`}><b className={t.page}>Notes:</b> {open.notes}</p>}
            </div>
            <div className={`p-5 border-t ${t.border} flex items-center gap-3 flex-wrap`}>
              <div className={`tabular-nums ${t.page}`}>
                <span className={`text-sm ${t.muted}`}>{open.line_count} lines · {open.unit_count} units · </span>
                <span className="text-lg font-bold">{formatLKR(open.total_cost)}</span>
                {open.invoice_total != null && (
                  <span className={`text-sm ml-2 ${t.muted}`}>(invoice {formatLKR(open.invoice_total)})</span>
                )}
              </div>
              <div className="ml-auto flex gap-2">
                {user?.role === 'admin' && open.can_void && (
                  <button onClick={() => voidGrn(open)} className={`${t.btnGhost} ${dm ? 'text-red-300' : 'text-red-600'}`}>Cancel GRN…</button>
                )}
                <button onClick={() => printRoll(open)} className={t.btnGhost}>Print</button>
                <button onClick={() => savePdf(open)} className={t.btnPrimary}>Save as PDF</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
