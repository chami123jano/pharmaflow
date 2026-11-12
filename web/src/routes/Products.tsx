import { useCategories, makeWebSku, skuOwner, type Group } from '../lib/categories';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth, canSeeMoney } from '../lib/auth';
import { lkr, expiryState } from '../lib/format';
import { Spinner, Empty, ErrorNote, Pill, Sheet } from '../components/ui';

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  generic_name: string | null;
  barcode: string | null;
  category: string | null;
  price: number;
  stock: number;
  supplier: string | null;
  description: string | null;
  expiry: string | null;
}



const BLANK = {
  name: '', sku: '', generic_name: '', barcode: '',
  category: '', price: '', supplier: '', description: '',
};

export default function Products() {
  const { role } = useAuth();
  const owner = canSeeMoney(role);
  const [all, setAll] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error } = await supabase
      .from('products')
      .select('id,name,sku,generic_name,barcode,category,price,stock,supplier,description,expiry')
      .order('name');
    if (error) { setError(error.message); return; }
    setAll(data as Product[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Matches the till's search: name, generic name, SKU or barcode. */
  const shown = useMemo(() => {
    if (!all) return [];
    const q = term.trim().toLowerCase();
    if (!q) return all.slice(0, 100);
    return all
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.generic_name || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q))
      .slice(0, 100);
  }, [all, term]);

  if (error) return <ErrorNote error={error} onRetry={load} />;
  if (!all) return <Spinner label="Loading products…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Products</h1>
        {owner && (
          <button onClick={() => setEditing('new')} className="btn-primary px-3 py-2 text-xs">
            + Add
          </button>
        )}
      </div>

      <input
        className="field"
        placeholder="Search name, generic, SKU or barcode…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        inputMode="search"
      />

      <p className="faint text-xs">
        {term ? `${shown.length} of ${all.length}` : `${all.length} products`}
        {!term && all.length > 100 && ' — showing the first 100, search for the rest'}
      </p>

      {shown.length === 0 ? (
        <Empty icon="🔍" title="Nothing matched" body="Try part of the name, or the generic name." />
      ) : (
        <ul className="space-y-2">
          {shown.map((p) => {
            const ex = expiryState(p.expiry);
            return (
              <li key={p.id}>
                <button
                  onClick={() => owner && setEditing(p)}
                  className={`card flex w-full items-center gap-3 p-3.5 text-left ${owner ? '' : 'cursor-default'}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.name}</p>
                    <p className="faint truncate text-xs">
                      {[p.generic_name, p.category, p.sku].filter(Boolean).join(' · ') || 'No details'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {/* Matches the till: zero is not a price, it is something
                        nobody has filled in yet. */}
                    <p className={`font-bold ${Number(p.price) > 0 ? '' : 'text-amber-500'}`}>
                      {Number(p.price) > 0 ? lkr(p.price) : 'no price'}
                    </p>
                    <div className="mt-0.5 flex items-center justify-end gap-1.5">
                      {ex.tone !== 'none' && ex.tone !== 'ok' && <Pill tone={ex.tone}>{ex.label}</Pill>}
                      <span className={`text-xs font-semibold ${p.stock <= 0 ? 'text-red-600' : p.stock < 10 ? 'text-amber-600' : 'muted'}`}>
                        {p.stock} left
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <Editor
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function Editor({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: product?.name ?? BLANK.name,
    sku: product?.sku ?? BLANK.sku,
    generic_name: product?.generic_name ?? BLANK.generic_name,
    barcode: product?.barcode ?? BLANK.barcode,
    category: product?.category ?? BLANK.category,
    price: product ? String(product.price) : BLANK.price,
    supplier: product?.supplier ?? BLANK.supplier,
    description: product?.description ?? BLANK.description,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cats = useCategories();
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newGroup, setNewGroup] = useState<Group>('Medicines');
  const known = [...cats.medicine, ...cats.shop, 'Other'];

  async function generate() {
    setF((prev) => ({ ...prev, sku: '…' }));
    const code = await makeWebSku(f.name, f.category);
    setF((prev) => ({ ...prev, sku: code }));
  }

  async function addCategory() {
    const e = await cats.add(newCat, newGroup);
    if (e) { setErr(e); return; }
    setF((prev) => ({ ...prev, category: newCat.trim().charAt(0).toUpperCase() + newCat.trim().slice(1) }));
    setAdding(false); setNewCat(''); setErr(null);
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  async function save() {
    const name = f.name.trim();
    if (!name) { setErr('A name is required.'); return; }
    const price = Number(f.price);
    if (!Number.isFinite(price) || price < 0) { setErr('Enter the price as a number.'); return; }

    setBusy(true);
    setErr(null);

    // A code like the till's, in the website's own "W-" range. A typed code
    // is kept, but not if another item already has it.
    let sku = f.sku.trim().toUpperCase();
    if (!sku || sku === '…') sku = await makeWebSku(name, f.category);
    else {
      const owner = await skuOwner(sku, product?.id);
      if (owner) { setBusy(false); setErr(`Code ${sku} is already used by ${owner}. Clear it to get a new one.`); return; }
    }

    const now = new Date().toISOString();
    const id = product?.id ?? crypto.randomUUID();
    const payload = {
      id, name,
      sku,
      generic_name: f.generic_name.trim() || null,
      barcode: f.barcode.trim() || null,
      category: f.category.trim() || null,
      price,
      supplier: f.supplier.trim() || null,
      description: f.description.trim() || null,
      updated_at: now,
      created_at: product ? undefined : now,
    };

    /**
     * The queue entry goes first, deliberately.
     *
     * If the event lands and the mirror write fails, the till still gets the
     * change and its next sync corrects the mirror. The other way round, the
     * website would show an edit the till never heard about — and the till's
     * next snapshot would quietly overwrite it back.
     */
    const { error: evErr } = await supabase.from('sync_events').insert({
      id: crypto.randomUUID(),
      device_id: 'web',
      type: 'product.upsert',
      payload,
      ts: now,
    });
    if (evErr) { setBusy(false); setErr(evErr.message); return; }

    // Stock is absent on purpose — it moves only as a delta from the till.
    const { error: upErr } = await supabase.from('products').upsert({
      id, name,
      sku: payload.sku, generic_name: payload.generic_name, barcode: payload.barcode,
      category: payload.category, price, supplier: payload.supplier,
      description: payload.description, updated_at: now,
    });
    setBusy(false);
    if (upErr) { setErr(upErr.message); return; }
    onSaved();
  }

  return (
    <Sheet title={product ? 'Edit product' : 'New product'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" value={f.name} onChange={set('name')} autoFocus placeholder="Panadol 500mg" />
        <Field label="Generic name" value={f.generic_name} onChange={set('generic_name')} placeholder="Paracetamol" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (Rs.)" value={f.price} onChange={set('price')} inputMode="decimal" placeholder="0.00" />
          <label className="block">
            <span className="faint mb-1.5 block text-[11px] font-bold uppercase tracking-wide">Category</span>
            <select className="field" value={f.category}
              onChange={(e) => { if (e.target.value === '__new__') setAdding(true); else setF((p) => ({ ...p, category: e.target.value })); }}>
              <option value="">Choose…</option>
              {f.category && !known.includes(f.category) && <option value={f.category}>{f.category}</option>}
              <optgroup label="Medicines">{cats.medicine.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
              <optgroup label="Shop items">{cats.shop.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
              <option value="Other">Other</option>
              <option value="__new__">+ Add a new category…</option>
            </select>
          </label>
        </div>
        {adding && (
          <div className="card space-y-2 p-3" style={{ background: 'var(--bg)' }}>
            <input className="field" autoFocus placeholder="New category name" value={newCat}
              onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }} />
            <div className="flex gap-2">
              {(['Medicines', 'Shop items'] as Group[]).map((g) => (
                <button key={g} type="button" onClick={() => setNewGroup(g)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${newGroup === g ? 'bg-teal-700 text-white' : 'card muted'}`}>{g === 'Medicines' ? 'Medicine' : 'Shop item'}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdding(false)} className="btn-ghost flex-1">Cancel</button>
              <button type="button" onClick={addCategory} className="btn-primary flex-1">Add category</button>
            </div>
            <p className="faint text-xs">Shows here at once, and on the till after its next sync.</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="faint mb-1.5 flex justify-between text-[11px] font-bold uppercase tracking-wide">
              SKU <button type="button" onClick={generate} className="normal-case text-teal-700 dark:text-teal-300">Generate</button>
            </span>
            <input className="field" value={f.sku} onChange={set('sku')} placeholder="Made for you if left blank" />
          </label>
          <Field label="Barcode" value={f.barcode} onChange={set('barcode')} inputMode="numeric" />
        </div>
        <Field label="Supplier" value={f.supplier} onChange={set('supplier')} />

        {product && (
          <div className="card p-3" style={{ background: 'var(--bg)' }}>
            <p className="faint text-[11px] font-bold uppercase tracking-wide">Stock</p>
            <p className="mt-0.5 font-bold">{product.stock} in hand</p>
            <p className="muted mt-1 text-xs">
              Stock cannot be changed from here. It moves at the till, and through deliveries recorded
              against a batch — so a sale and a delivery can never overwrite each other.
            </p>
          </div>
        )}

        {err && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300">
            {err}
          </p>
        )}

        <p className="faint text-xs">
          Saved here first, then picked up by the till the next time it syncs.
        </p>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-primary flex-1">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="faint mb-1.5 block text-[11px] font-bold uppercase tracking-wide">{label}</span>
      <input className="field" {...rest} />
    </label>
  );
}
