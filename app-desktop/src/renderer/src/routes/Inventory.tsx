import { useState, useEffect, useRef } from 'react';
import { formatLKR } from '../lib/format';
import { useShortcuts } from '../hooks/useShortcuts';
import { useToast } from '../components/Toast';
import BulkImport from '../components/BulkImport';
import BatchPanel from '../components/BatchPanel';
import { ui, pill } from '../lib/ui';

// Kept in step with the seed catalogue in src/main/data/medicines-lk.ts.
const CATS = ['All','Analgesic','Antibiotic','Antidiabetic','Antifungal','Antihistamine','Antihypertensive','Antiparasitic','Antiviral','Ayurvedic','Cardiac','CNS','Diuretic','First Aid','GI','Gynaecology','NSAID','Ophthalmic','Respiratory','Rheumatology','Statin','Steroid','Supplement','Thyroid','Topical','Urological','Other'];

function Badge({ stock }: { stock: number }) {
  if (stock === 0) return <span className={pill('out')}>Out</span>;
  if (stock <= 10) return <span className={pill('low')}>Low</span>;
  return <span className={pill('ok')}>OK</span>;
}

export default function Inventory({ user, tokens, darkMode }: { user: any; tokens?: any; darkMode?: boolean }) {
  const toast = useToast();
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

  const emptyForm = { name:'', sku:'', price:'', stock:'0', category:'Analgesic', supplier:'', expiry:'', description:'', generic_name:'', barcode:'' };
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
    const res: any = await window.api?.products?.create?.({ ...form, price: Number(form.price), stock: Number(form.stock) });
    setLoading(false);
    if (res?.ok) {
      toast.success(`Added ${form.name}`);
      setForm(emptyForm);
      fetchProducts();
      if (keepOpen) setTimeout(() => nameRef.current?.focus(), 50);
      else setShowAdd(false);
    }
    else toast.error(res?.error === 'SKU_EXISTS' ? 'SKU already exists' : (res?.error || 'Failed'));
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true);
    const res: any = await window.api?.products?.update?.(showEdit.id, { ...form, price: Number(form.price), stock: Number(form.stock) });
    setLoading(false);
    if (res?.ok) { toast.success('Product updated!'); setShowEdit(null); fetchProducts(); }
    else toast.error(res?.error || 'Failed');
  }

  async function handleDelete(p: any) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    const res: any = await window.api?.products?.delete?.(p.id);
    if (res?.ok) { toast.success('Deleted'); fetchProducts(); }
    else toast.error(res?.error || 'Failed');
  }

  async function handleRestock() {
    const res: any = await window.api?.products?.adjustStock?.(showRestock.id, restockQty);
    if (res?.ok) { toast.success(`Added ${restockQty} units`); setRestock(null); fetchProducts(); }
    else toast.error(res?.error || 'Failed');
  }

  function openEdit(p: any) {
    setForm({ name:p.name||'', sku:p.sku||'', price:String(p.price||''), stock:String(p.stock||0), category:p.category||'Analgesic', supplier:p.supplier||'', expiry:p.expiry||'', description:p.description||'', generic_name:p.generic_name||'', barcode:p.barcode||'' });
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
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
      <div className={`${tbg} border rounded-2xl p-4 space-y-3`}>
        <div className="flex gap-3 w-full">
          <div className="relative flex-1 min-w-0">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search by name, brand, SKU, category... (Ctrl+F)"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); setSelected(-1); }}
              className={`w-full px-4 py-3 pr-10 rounded-xl border-2 text-sm focus:outline-none focus:border-blue-500 transition-colors ${dm ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
            />
            {search && (
              <button onClick={() => { setSearch(''); setPage(1); searchRef.current?.focus(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xl leading-none">
                &times;
              </button>
            )}
          </div>
          <select
            value={stockFilter}
            onChange={e => { setStock(e.target.value); setPage(1); }}
            className={`px-4 py-3 rounded-xl border-2 text-sm focus:outline-none focus:border-blue-500 shrink-0 ${dm ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}>
            <option value="all">All Stock</option>
            <option value="ok">In Stock</option>
            <option value="low">Low (1-10)</option>
            <option value="out">Out of Stock</option>
          </select>
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATS.map(c => (
            <button key={c} onClick={() => { setCat(c); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${cat===c ? 'bg-blue-600 text-white' : dm ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className={`${tbg} border rounded-2xl overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={`border-b ${dm ? 'border-gray-700 bg-gray-750' : 'border-gray-100 bg-gray-50'}`}>
              <tr>
                {['SKU','Name','Category','Price','Stock','Status','Expiry','Actions'].map(h => (
                  <th key={h} className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide ${ts}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr><td colSpan={8} className={`text-center py-12 ${ts}`}>No products found</td></tr>
              ) : paged.map((p, i) => (
                <tr key={p.id} onClick={() => setSelected(i)}
                  className={`border-b transition-colors cursor-pointer ${dm ? 'border-gray-700' : 'border-gray-50'} ${selected===i ? 'bg-blue-50 dark:bg-blue-900/20' : dm ? 'hover:bg-gray-700' : 'hover:bg-gray-50'}`}>
                  <td className={`px-4 py-3 font-mono text-xs ${ts}`}>{p.sku}</td>
                  <td className={`px-4 py-3 font-medium ${tp} max-w-48 truncate`}>{p.name}</td>
                  <td className={`px-4 py-3 text-xs ${ts}`}>{p.category || '-'}</td>
                  <td className={`px-4 py-3 font-semibold text-green-600`}>{formatLKR(p.price)}</td>
                  <td className={`px-4 py-3 font-bold ${tp}`}>{p.stock}</td>
                  <td className="px-4 py-3"><Badge stock={p.stock} /></td>
                  <td className={`px-4 py-3 text-xs ${ts}`}>{p.expiry ? p.expiry.slice(0,7) : '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={e=>{e.stopPropagation();openEdit(p);}} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium">Edit</button>
                      <button onClick={e=>{e.stopPropagation();setRestock(p);}} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium">Batches</button>
                      <button onClick={e=>{e.stopPropagation();handleDelete(p);}} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium">Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className={`flex items-center justify-between px-4 py-3 border-t ${dm ? 'border-gray-700' : 'border-gray-100'}`}>
            <span className={`text-xs ${ts}`}>{filtered.length} products, page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1} className={`px-3 py-1 text-xs rounded-lg ${dm ? 'bg-gray-700 text-gray-300 disabled:opacity-40 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 disabled:opacity-40 hover:bg-gray-200'}`}>Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages} className={`px-3 py-1 text-xs rounded-lg ${dm ? 'bg-gray-700 text-gray-300 disabled:opacity-40 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 disabled:opacity-40 hover:bg-gray-200'}`}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-xl ${dm ? 'bg-gray-800' : 'bg-white'} p-6`}>
            <h3 className={`text-lg font-bold mb-5 ${tp}`}>Add New Product</h3>
            <form onSubmit={handleAdd} className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className={lbl}>Product Name *</label>
                <input ref={nameRef} autoFocus required className={inp} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Panadol 500mg" /></div>
              <div><label className={lbl}>Generic name</label>
                <input className={inp} value={form.generic_name} onChange={e=>setForm(f=>({...f,generic_name:e.target.value}))} placeholder="Paracetamol" /></div>
              <div><label className={lbl}>Barcode</label>
                <input className={inp} value={form.barcode} onChange={e=>setForm(f=>({...f,barcode:e.target.value}))} placeholder="Scan or type" /></div>
              <div><label className={lbl}>SKU <button type="button" onClick={generateSku} className="ml-2 text-blue-500 hover:underline text-xs normal-case font-normal">Generate</button></label>
                <input required className={inp} value={form.sku} onChange={e=>setForm(f=>({...f,sku:e.target.value.toUpperCase()}))} placeholder="LK-PARA-500" /></div>
              <div><label className={lbl}>Category</label>
                <select className={inp} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                  {CATS.slice(1).map(c => <option key={c}>{c}</option>)}
                </select></div>
              <div><label className={lbl}>Price (LKR) *</label>
                <input required type="number" min="0" step="0.01" className={inp} value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} /></div>
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
                <button type="button" onClick={()=>setShowAdd(false)} className={`flex-1 py-2.5 rounded-xl border font-medium ${dm?'border-gray-600 text-gray-300 hover:bg-gray-700':'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>Close (Esc)</button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50">Save (Enter)</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-xl ${dm ? 'bg-gray-800' : 'bg-white'} p-6`}>
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
                <select className={inp} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                  {CATS.slice(1).map(c => <option key={c}>{c}</option>)}
                </select></div>
              <div><label className={lbl}>Price (LKR) *</label>
                <input required type="number" min="0" step="0.01" className={inp} value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} /></div>
              <div><label className={lbl}>Stock</label>
                <input type="number" min="0" className={inp} value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))} /></div>
              <div><label className={lbl}>Expiry Date</label>
                <input type="date" className={inp} value={form.expiry} onChange={e=>setForm(f=>({...f,expiry:e.target.value}))} /></div>
              <div><label className={lbl}>Supplier</label>
                <input className={inp} value={form.supplier} onChange={e=>setForm(f=>({...f,supplier:e.target.value}))} /></div>
              <div className="col-span-2 flex gap-3 pt-2">
                <button type="button" onClick={()=>setShowEdit(null)} className={`flex-1 py-2.5 rounded-xl border font-medium ${dm?'border-gray-600 text-gray-300':'border-gray-300 text-gray-700'}`}>Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50">Save Changes</button>
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