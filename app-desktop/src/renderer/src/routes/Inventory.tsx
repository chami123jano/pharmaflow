import { useState, useEffect, useRef } from 'react';
import { formatLKR } from '../lib/format';
import { useShortcuts } from '../hooks/useShortcuts';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import BulkImport from '../components/BulkImport';
import BatchPanel from '../components/BatchPanel';
import Select from '../components/Select';
import { ui, pill } from '../lib/ui';

// Kept in step with the seed catalogue in src/main/data/medicines-lk.ts.
/**
 * Categories, in two groups.
 *
 * A pharmacy counter sells more than medicine — milk powder, baby food,
 * soothers, Milo, cosmetics. With only medical groups to choose from those
 * ended up under "Supplement" or "Other", and the filter could not find them.
 * The two lists are kept apart so the dropdown reads as two short sections
 * rather than one wall of thirty-odd names.
 */
const MEDICINE_CATS = ['Analgesic','Antibiotic','Antidiabetic','Antifungal','Antihistamine','Antihypertensive','Antiparasitic','Antiviral','Ayurvedic','Cardiac','CNS','Diuretic','First Aid','GI','Gynaecology','NSAID','Ophthalmic','Respiratory','Rheumatology','Statin','Steroid','Supplement','Thyroid','Topical','Urological'];
const SHOP_CATS = ['Milk Powder','Baby Food','Baby Care','Beverages','Biscuits & Snacks','Cosmetics','Personal Care'];
const CATS = ['All', ...MEDICINE_CATS, ...SHOP_CATS, 'Other'];

/**
 * Options for the category dropdown, grouped and searchable. A product
 * imported with a category outside these lists keeps it — it is offered as
 * its own option rather than the dropdown showing the first entry, which made
 * it look as if the category had changed.
 */
function categoryOptions(current?: string) {
  const opts = [
    ...MEDICINE_CATS.map((c) => ({ value: c, label: c, group: 'Medicines' })),
    ...SHOP_CATS.map((c) => ({ value: c, label: c, group: 'Shop items' })),
    { value: 'Other', label: 'Other', group: 'Other' },
  ];
  if (current && !opts.some((o) => o.value === current)) {
    opts.unshift({ value: current, label: current, group: 'Current' });
  }
  return opts;
}

/**
 * What one unit earns, worked out as the price and cost are typed.
 *
 * Margin is profit as a share of the selling price — the figure that matches
 * the Profit report. Markup (profit as a share of cost) is shown beside it
 * because that is how suppliers and many owners talk about it.
 */
function MarginNote({ price, cost, dark }: { price: string; cost: string; dark?: boolean }) {
  const p = Number(price), c = Number(cost);
  const base = 'col-span-2 -mt-2 text-sm rounded-xl px-3.5 py-2.5';
  if (String(cost).trim() === '' || !Number.isFinite(c)) {
    return <p className={`${base} ${dark ? 'bg-slate-700/40 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
      Enter the cost to see the profit on each one. Deliveries fill it in for you.
    </p>;
  }
  if (!(p > 0)) return null;
  const each = Math.round((p - c) * 100) / 100;
  if (each <= 0) {
    return <p className={`${base} font-medium ${dark ? 'bg-red-950/40 text-red-300' : 'bg-red-50 text-red-700'}`}>
      {each === 0 ? 'Selling at cost — no profit on this item.' : `Selling below cost — every one sold loses ${formatLKR(-each)}.`}
    </p>;
  }
  return <p className={`${base} ${dark ? 'bg-lime-950/40 text-lime-300' : 'bg-lime-50 text-lime-800'}`}>
    Profit <b>{formatLKR(each)}</b> on each · margin <b>{Math.round((each / p) * 1000) / 10}%</b>
    <span className="opacity-70"> (markup {c > 0 ? Math.round((each / c) * 1000) / 10 + '%' : '—'})</span>
  </p>;
}

function Badge({ stock }: { stock: number }) {
  if (stock === 0) return <span className={pill('out')}>Out</span>;
  if (stock <= 10) return <span className={pill('low')}>Low</span>;
  return <span className={pill('ok')}>OK</span>;
}

export default function Inventory({ user, tokens, darkMode }: { user: any; tokens?: any; darkMode?: boolean }) {
  const toast = useToast();
  const ask = useConfirm();
  const isAdmin = user?.role === 'admin';
  const [products, setProducts]   = useState<any[]>([]);
  const [search, setSearch]       = useState('');
  const [cat, setCat]             = useState('All');
  const [stockFilter, setStock]   = useState('all');
  const [page, setPage]           = useState(1);
  const [selected, setSelected]   = useState<number>(-1);
  const [showAdd, setShowAdd]     = useState(false);
  const [showEdit, setShowEdit]   = useState<any>(null);
  const [showRestock, setRestock] = useState<any>(null);
  const [loading, setLoading]     = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const PER_PAGE = 15;

  const emptyForm = { name:'', sku:'', price:'', cost_price:'', stock:'0', category:'Analgesic', supplier:'', expiry:'', description:'', generic_name:'', barcode:'' };
  const [form, setForm] = useState(emptyForm);
  const [showBulk, setShowBulk] = useState(false);
  // When entering a run of products, the form stays open and clears itself so
  // the next one can be typed straight away.
  const [keepOpen, setKeepOpen] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const [restockQty, setRestockQty] = useState(10);

  useEffect(() => { fetchProducts(); setTimeout(() => searchRef.current?.focus(), 200); }, []);

  async function fetchProducts() {
    const res: any = await window.api?.products?.list?.();
    if (res?.ok) setProducts(res.data || []);
  }

  const filtered = products.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q) || p.supplier?.toLowerCase().includes(q) || p.generic_name?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q);
    const matchCat    = cat === 'All' || p.category === cat;
    const matchStock  = stockFilter === 'all' || (stockFilter === 'low' && p.stock > 0 && p.stock <= 10) || (stockFilter === 'out' && p.stock === 0) || (stockFilter === 'ok' && p.stock > 10);
    return matchSearch && matchCat && matchStock;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paged = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE);

  async function generateSku() {
    const res: any = await window.api?.products?.generateSku?.({ name: form.name, category: form.category });
    if (res?.ok) setForm(f => ({ ...f, sku: res.data.sku }));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    const res: any = await window.api?.products?.create?.({ ...form, price: Number(form.price), stock: Number(form.stock),
      cost_price: isAdmin ? form.cost_price : '' });
    setLoading(false);
    if (res?.ok) {
      toast.success(`Added ${form.name}`);
      setForm(emptyForm);
      fetchProducts();
      if (keepOpen) setTimeout(() => nameRef.current?.focus(), 50);
      else setShowAdd(false);
    }
    else toast.error(res?.error === 'SKU_EXISTS' ? 'SKU already exists' : (res?.message || res?.error || 'Failed'));
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    // stock is deliberately not sent — it belongs to the batches
    const { stock: _unused, cost_price, ...details } = form;
    // Only an admin sees the cost, so only an admin's save may change it.
    const patch: any = { ...details, price: Number(form.price) };
    if (isAdmin) patch.cost_price = cost_price;
    const res: any = await window.api?.products?.update?.(showEdit.id, patch);
    setLoading(false);
    if (res?.ok) { toast.success('Product updated!'); setShowEdit(null); fetchProducts(); }
    else toast.error(res?.message || res?.error || 'Failed');
  }

  async function handleDelete(p: any) {
    if (!(await ask({ title: `Delete ${p.name}?`, message: 'This cannot be undone.', tone: 'danger' }))) return;
    const res: any = await window.api?.products?.delete?.(p.id);
    if (res?.ok) { toast.success('Deleted'); fetchProducts(); }
    else toast.error(res?.message || res?.error || 'Failed');
  }

  async function handleRestock() {
    const res: any = await window.api?.products?.adjustStock?.(showRestock.id, restockQty);
    if (res?.ok) { toast.success(`Added ${restockQty} units`); setRestock(null); fetchProducts(); }
    else toast.error(res?.message || res?.error || 'Failed');
  }

  function openEdit(p: any) {
    setForm({ name:p.name||'', sku:p.sku||'', price:String(p.price||''), cost_price:p.cost_price != null ? String(p.cost_price) : '', stock:String(p.stock||0), category:p.category||'Analgesic', supplier:p.supplier||'', expiry:p.expiry||'', description:p.description||'', generic_name:p.generic_name||'', barcode:p.barcode||'' });
    setShowEdit(p);
  }

  useShortcuts([
    { key:'N', ctrl:true, description:'New product', group:'Inventory', action:() => { setForm(emptyForm); setShowAdd(true); } },
    { key:'F', ctrl:true, description:'Focus search', group:'Inventory', action:() => searchRef.current?.focus() },
    { key:'F2', description:'Edit selected', group:'Inventory', action:() => { if (paged[selected]) openEdit(paged[selected]); } },
    { key:'Delete', description:'Delete selected', group:'Inventory', action:() => { if (paged[selected]) handleDelete(paged[selected]); }, enabled: !showAdd && !showEdit },
    { key:'ArrowDown', description:'Next row', group:'Inventory', action:() => setSelected(s => Math.min(s+1, paged.length-1)), enabled:!showAdd&&!showEdit&&!showRestock },
    { key:'ArrowUp',   description:'Prev row', group:'Inventory', action:() => setSelected(s => Math.max(0, s-1)), enabled:!showAdd&&!showEdit&&!showRestock },
    { key:'Escape', description:'Close modal', group:'Inventory', action:() => { setShowAdd(false); setShowEdit(null); setRestock(null); setShowBulk(false); }, enabled:showAdd||!!showEdit||!!showRestock||showBulk },
    { key:'I', ctrl:true, shift:true, description:'Paste / import products', group:'Inventory', action:() => setShowBulk(true) },
  ]);

  const dm = darkMode;
  const t = ui(dm);
  const inp = t.input;
  const lbl = t.label;
  const tp  = t.page;
  const ts  = t.muted;
  const tbg = dm ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200';

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-2.5rem)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${tp}`}>Inventory</h1>
          <p className={`text-sm ${ts}`}>{products.length} products &bull; {products.filter(p=>p.stock<=0).length} out of stock</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.api?.admin?.seedCommonProductsLK?.().then((r:any) => { toast.success(`Seeded ${r?.data?.inserted||0} medicines`); fetchProducts(); })}
            className={t.btnGhost}>
            Seed Medicines
          </button>
          <button onClick={() => setShowBulk(true)}
            className={t.btnSuccess}>
            Paste / Import
          </button>
          <button onClick={() => { setForm(emptyForm); setShowAdd(true); }}
            className={t.btnPrimary}>
            + Add Product
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className={`${tbg} border rounded-2xl p-3 space-y-2.5 shrink-0`}>
        <div className="flex gap-3 w-full">
          <div className="relative flex-1 min-w-0">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search by name, brand, SKU, category... (Ctrl+F)"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); setSelected(-1); }}
              className={`w-full px-4 py-3 pr-10 rounded-xl border-2 text-sm focus:outline-none focus:border-teal-600 transition-colors ${dm ? 'bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'}`}
            />
            {search && (
              <button onClick={() => { setSearch(''); setPage(1); searchRef.current?.focus(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xl leading-none">
                &times;
              </button>
            )}
          </div>
          <div className="w-44 shrink-0">
            <Select aria-label="Stock level" value={stockFilter} onChange={(v) => { setStock(v); setPage(1); }}
              options={[
                { value: 'all', label: 'All stock' },
                { value: 'ok',  label: 'In stock' },
                { value: 'low', label: 'Low (1–10)' },
                { value: 'out', label: 'Out of stock' },
              ]} />
          </div>
        </div>
        {/* One line that scrolls sideways. Wrapping put 25 categories on two
            rows and cost the table four more products of height. */}
        <div className="flex gap-2 overflow-x-auto pb-0.5 -mb-0.5 [scrollbar-width:thin]">
          {CATS.map(c => (
            <span key={c} className="contents">
            {c === SHOP_CATS[0] && <span className={`w-px self-stretch shrink-0 mx-1 ${dm ? 'bg-slate-600' : 'bg-slate-300'}`} aria-hidden="true" />}
            <button
              // The row scrolls sideways, and the shop categories sit past the
              // edge of the screen. Bring a chip fully into view when chosen,
              // so the active filter is always visible.
              onClick={(e) => { setCat(c); setPage(1); e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' }); }}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${cat===c ? 'bg-teal-700 text-white' : dm ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {c}
            </button>
            </span>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className={`${tbg} border rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col`}>
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className={`sticky top-0 z-10 border-b ${dm ? 'border-slate-700 bg-slate-800' : 'border-slate-100 bg-slate-50'}`}>
              <tr>
                {['Name','SKU','Category','Price','Stock','Status','Expiry','Actions'].map(h => (
                  <th key={h} className={`text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${ts}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr><td colSpan={8} className="py-16">
                  <div className="text-center">
                    <p className={`text-sm font-medium ${tp}`}>Nothing matched</p>
                    <p className={`text-xs mt-1 ${ts}`}>Try part of the name, the generic name, or clear the filters.</p>
                  </div>
                </td></tr>
              ) : paged.map((p, i) => (
                <tr key={p.id} onClick={() => setSelected(i)}
                  className={`border-b transition-colors cursor-pointer ${dm ? 'border-slate-700' : 'border-slate-50'} ${selected===i ? 'bg-teal-50 dark:bg-teal-900/20' : dm ? 'hover:bg-slate-700' : 'hover:bg-slate-50'}`}>
                  <td className={`px-4 py-2 font-medium ${tp} max-w-64 truncate`}>
                    {p.name}
                    {p.generic_name && <span className={`block text-[11px] font-normal truncate ${ts}`}>{p.generic_name}</span>}
                  </td>
                  <td className={`px-4 py-2 font-mono text-xs ${ts}`}>{p.sku || '-'}</td>
                  <td className={`px-4 py-2 text-xs ${ts}`}>{p.category || '-'}</td>
                  {/* A price of zero is not good news, so it is not shown in green. */}
                  <td className={`px-4 py-2 font-semibold tabular-nums ${Number(p.price) > 0 ? (dm ? 'text-lime-400' : 'text-lime-700') : 'text-amber-600'}`}>
                    {Number(p.price) > 0 ? formatLKR(p.price) : 'no price'}
                    {/* Cost and margin for the owner only — not something the counter needs to see. */}
                    {isAdmin && Number(p.price) > 0 && (
                      p.cost_price != null
                        ? <span className={`block text-[11px] font-normal ${Number(p.price) <= Number(p.cost_price) ? 'text-red-600' : ts}`}>
                            cost {formatLKR(p.cost_price)} · {Math.round(((Number(p.price) - Number(p.cost_price)) / Number(p.price)) * 100)}%
                          </span>
                        : <span className="block text-[11px] font-normal text-amber-600">no cost</span>
                    )}
                  </td>
                  <td className={`px-4 py-2 font-bold tabular-nums ${tp}`}>{p.stock}</td>
                  <td className="px-4 py-2"><Badge stock={p.stock} /></td>
                  <td className={`px-4 py-2 text-xs tabular-nums ${ts}`}>{p.expiry ? p.expiry.slice(0,7) : '-'}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <button onClick={e=>{e.stopPropagation();openEdit(p);}} className="px-2.5 py-1 text-xs bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200 font-semibold">Edit</button>
                      <button onClick={e=>{e.stopPropagation();setRestock(p);}} className="px-2.5 py-1 text-xs bg-lime-100 text-lime-800 rounded-lg hover:bg-lime-200 font-semibold">Stock</button>
                      <button onClick={e=>{e.stopPropagation();handleDelete(p);}} className="px-2.5 py-1 text-xs bg-red-100 text-red-600 rounded-lg hover:bg-red-200 font-semibold">Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className={`shrink-0 flex items-center justify-between px-4 py-2.5 border-t ${dm ? 'border-slate-700' : 'border-slate-100'}`}>
            <span className={`text-xs ${ts}`}>{filtered.length} products, page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1} className={`px-3 py-1 text-xs rounded-lg ${dm ? 'bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600' : 'bg-slate-100 text-slate-600 disabled:opacity-40 hover:bg-slate-200'}`}>Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages} className={`px-3 py-1 text-xs rounded-lg ${dm ? 'bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600' : 'bg-slate-100 text-slate-600 disabled:opacity-40 hover:bg-slate-200'}`}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-xl ${dm ? 'bg-slate-800' : 'bg-white'} p-6`}>
            <h3 className={`text-lg font-bold mb-5 ${tp}`}>Add New Product</h3>
            <form onSubmit={handleAdd} className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className={lbl}>Product Name *</label>
                <input ref={nameRef} autoFocus required className={inp} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Panadol 500mg" /></div>
              <div><label className={lbl}>Generic name</label>
                <input className={inp} value={form.generic_name} onChange={e=>setForm(f=>({...f,generic_name:e.target.value}))} placeholder="Paracetamol" /></div>
              <div><label className={lbl}>Barcode</label>
                <input className={inp} value={form.barcode} onChange={e=>setForm(f=>({...f,barcode:e.target.value}))} placeholder="Scan or type" /></div>
              <div><label className={lbl}>SKU <button type="button" onClick={generateSku} className="ml-2 text-teal-600 hover:underline text-xs normal-case font-normal">Generate</button></label>
                <input required className={inp} value={form.sku} onChange={e=>setForm(f=>({...f,sku:e.target.value.toUpperCase()}))} placeholder="LK-PARA-500" /></div>
              <div><label className={lbl}>Category</label>
                <Select aria-label="Category" value={form.category} onChange={(v) => setForm(f => ({ ...f, category: v }))} options={categoryOptions(form.category)} /></div>
              <div><label className={lbl}>Selling price (LKR) *</label>
                <input required type="number" min="0" step="0.01" className={inp} value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} /></div>
              {isAdmin && (
                <div><label className={lbl}>Cost price (LKR)</label>
                  <input type="number" min="0" step="0.01" className={inp} value={form.cost_price} placeholder="What you pay for one"
                    onChange={e=>setForm(f=>({...f,cost_price:e.target.value}))} /></div>
              )}
              {isAdmin && <MarginNote price={form.price} cost={form.cost_price} dark={dm} />}
              <div><label className={lbl}>Initial Stock</label>
                <input type="number" min="0" className={inp} value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))} /></div>
              <div><label className={lbl}>Expiry Date</label>
                <input type="date" className={inp} value={form.expiry} onChange={e=>setForm(f=>({...f,expiry:e.target.value}))} /></div>
              <div><label className={lbl}>Supplier</label>
                <input className={inp} value={form.supplier} onChange={e=>setForm(f=>({...f,supplier:e.target.value}))} /></div>
              <label className={`col-span-2 flex items-center gap-2 text-sm cursor-pointer ${ts}`}>
                <input type="checkbox" checked={keepOpen} onChange={e=>setKeepOpen(e.target.checked)} className="w-4 h-4" />
                Keep this form open to add another
              </label>
              <div className="col-span-2 flex gap-3 pt-2">
                <button type="button" onClick={()=>setShowAdd(false)} className={`flex-1 py-2.5 rounded-xl border font-medium ${dm?'border-slate-600 text-slate-300 hover:bg-slate-700':'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>Close (Esc)</button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-teal-700 text-white font-bold hover:bg-teal-800 disabled:opacity-50">Save (Enter)</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-xl ${dm ? 'bg-slate-800' : 'bg-white'} p-6`}>
            <h3 className={`text-lg font-bold mb-5 ${tp}`}>Edit Product</h3>
            <form onSubmit={handleEdit} className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className={lbl}>Product Name *</label>
                <input required className={inp} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
              <div><label className={lbl}>Generic name</label>
                <input className={inp} value={form.generic_name} onChange={e=>setForm(f=>({...f,generic_name:e.target.value}))} placeholder="Paracetamol" /></div>
              <div><label className={lbl}>Barcode</label>
                <input className={inp} value={form.barcode} onChange={e=>setForm(f=>({...f,barcode:e.target.value}))} placeholder="Scan or type" /></div>
              <div><label className={lbl}>SKU</label>
                <input required className={inp} value={form.sku} onChange={e=>setForm(f=>({...f,sku:e.target.value.toUpperCase()}))} /></div>
              <div><label className={lbl}>Category</label>
                <Select aria-label="Category" value={form.category} onChange={(v) => setForm(f => ({ ...f, category: v }))} options={categoryOptions(form.category)} /></div>
              <div><label className={lbl}>Selling price (LKR) *</label>
                <input required type="number" min="0" step="0.01" className={inp} value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} /></div>
              {isAdmin && (
                <div><label className={lbl}>Cost price (LKR)</label>
                  <input type="number" min="0" step="0.01" className={inp} value={form.cost_price} placeholder="What you pay for one"
                    onChange={e=>setForm(f=>({...f,cost_price:e.target.value}))} /></div>
              )}
              {isAdmin && <MarginNote price={form.price} cost={form.cost_price} dark={dm} />}
              <div>
                <label className={lbl}>Stock</label>
                {/* Read-only on purpose: stock is the sum of the batches, so a
                    number typed here used to vanish the next time anything
                    touched the product. */}
                <div className={`flex items-center gap-2 ${inp} cursor-default`}>
                  <span className="font-bold">{showEdit?.stock ?? 0}</span>
                  <button type="button"
                    onClick={() => { const p = showEdit; setShowEdit(null); setRestock(p); }}
                    className="ml-auto text-xs font-semibold text-teal-700 hover:underline">
                    Add or adjust stock
                  </button>
                </div>
              </div>
              <div><label className={lbl}>Expiry Date</label>
                <input type="date" className={inp} value={form.expiry} onChange={e=>setForm(f=>({...f,expiry:e.target.value}))} /></div>
              <div><label className={lbl}>Supplier</label>
                <input className={inp} value={form.supplier} onChange={e=>setForm(f=>({...f,supplier:e.target.value}))} /></div>
              <div className="col-span-2 flex gap-3 pt-2">
                <button type="button" onClick={()=>setShowEdit(null)} className={`flex-1 py-2.5 rounded-xl border font-medium ${dm?'border-slate-600 text-slate-300':'border-slate-300 text-slate-700'}`}>Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-teal-700 text-white font-bold hover:bg-teal-800 disabled:opacity-50">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receiving a delivery, with its own expiry date */}
      {showRestock && (
        <BatchPanel
          product={showRestock}
          user={user}
          darkMode={dm}
          onClose={() => setRestock(null)}
          onChanged={fetchProducts}
        />
      )}
      {showBulk && (
        <BulkImport
          existing={products}
          darkMode={dm}
          onClose={() => setShowBulk(false)}
          onImported={fetchProducts}
        />
      )}

    </div>
  );
}