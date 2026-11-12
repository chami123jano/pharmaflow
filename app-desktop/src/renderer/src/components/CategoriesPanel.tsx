import { useEffect, useState } from 'react';
import { useCategories, MEDICINE_CATS, SHOP_CATS, type CatGroup } from '../lib/categories';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { ui } from '../lib/ui';

/**
 * The shop's categories: the built-in ones, and any the owner has added.
 *
 * Built-in names cannot be removed — other screens, the website and the
 * medicine list rely on their spelling. Removing an added one only takes it
 * off the list; items already in it keep it.
 */
export default function CategoriesPanel({ darkMode, user }: { darkMode?: boolean; user?: any }) {
  const t = ui(darkMode);
  const dm = !!darkMode;
  const toast = useToast();
  const ask = useConfirm();
  const cats = useCategories(user?.id);
  const [prefix, setPrefix] = useState('');
  const [prefixSaved, setPrefixSaved] = useState('');
  const [name, setName] = useState('');
  const [group, setGroup] = useState<CatGroup>('Medicines');
  const [err, setErr] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const px: any = await (window as any).api?.sku?.prefix?.();
      if (px?.ok) { setPrefix(px.data); setPrefixSaved(px.data); }
      const r: any = await (window as any).api?.products?.list?.();
      const m: Record<string, number> = {};
      for (const p of r?.data || []) if (p.category) m[p.category] = (m[p.category] || 0) + 1;
      setCounts(m);
    })();
  }, []);

  async function add() {
    const e = await cats.add(name, group);
    if (e) { setErr(e); return; }
    toast.success('Category added');
    setName(''); setErr('');
  }

  async function remove(n: string) {
    const used = counts[n] || 0;
    if (!(await ask({
      title: `Remove "${n}"?`,
      message: used
        ? `${used} item${used === 1 ? ' is' : 's are'} in this category and will keep it. It just won't be offered for new items.`
        : 'It is taken off the list. No items use it.',
      confirmLabel: 'Remove', tone: 'danger',
    }))) return;
    await cats.remove(n);
    toast.info(`"${n}" removed`);
  }

  const Chip = ({ n }: { n: string }) => {
    const custom = cats.isCustom(n);
    return (
      <span className={`inline-flex items-center gap-1.5 pl-3 ${custom ? 'pr-1' : 'pr-3'} py-1 rounded-full text-sm ${
        custom ? (dm ? 'bg-teal-900/50 text-teal-100 ring-1 ring-teal-700' : 'bg-teal-50 text-teal-900 ring-1 ring-teal-200')
               : (dm ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-700')}`}>
        {n}
        {counts[n] ? <span className={`text-[11px] ${t.muted}`}>{counts[n]}</span> : null}
        {custom && (
          <button onClick={() => remove(n)} aria-label={`Remove ${n}`}
            className={`w-6 h-6 rounded-full grid place-items-center ${dm ? 'hover:bg-red-900/50 hover:text-red-300' : 'hover:bg-red-100 hover:text-red-700'}`}>✕</button>
        )}
      </span>
    );
  };

  return (
    <div className={`${t.card} p-5 max-w-4xl`}>
      <h2 className={`text-lg font-bold ${t.page}`}>Categories</h2>
      <p className={`text-sm mt-0.5 mb-5 ${t.muted}`}>
        Used to group items in Inventory and in reports. Add your own below; the grey ones come with the app and stay.
      </p>

      <div className={`${t.well} p-3 flex gap-2 items-center flex-wrap`}>
        <input className={`${t.input} flex-1 min-w-[200px]`} placeholder="New category, e.g. Diabetic Care" value={name}
          onChange={(e) => { setName(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <div role="radiogroup" aria-label="Group" className={`grid grid-cols-2 p-1 rounded-xl border ${dm ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-200'}`}>
          {(['Medicines', 'Shop items'] as CatGroup[]).map((g) => (
            <button key={g} role="radio" aria-checked={group === g} onClick={() => setGroup(g)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${group === g ? 'bg-teal-700 text-white' : t.muted}`}>{g}</button>
          ))}
        </div>
        <button onClick={add} className={t.btnPrimary}>Add category</button>
      </div>
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}

      <h3 className={`mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider ${t.muted}`}>
        Medicines · {cats.medicine.length}
      </h3>
      <div className="flex flex-wrap gap-2">{cats.medicine.map((n) => <Chip key={n} n={n} />)}</div>

      <h3 className={`mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wider ${t.muted}`}>
        Shop items · {cats.shop.length}
      </h3>
      <div className="flex flex-wrap gap-2">{cats.shop.map((n) => <Chip key={n} n={n} />)}</div>

      {/* Each place makes item codes in its own range, so the till and the
          website can add items at the same time and never pick the same code. */}
      <div className={`mt-6 pt-5 border-t ${t.border}`}>
        <h3 className={`font-semibold ${t.page}`}>Item codes (SKU) made on this PC</h3>
        <p className={`text-sm mt-0.5 ${t.muted}`}>
          New items added here get codes starting <b className={t.page}>{(prefixSaved || 'LK')}-</b>; items added on the website start <b className={t.page}>W-</b>.
          If you use a second PC, give it different letters (for example H for home) so the two never make the same code.
        </p>
        <div className="mt-3 flex gap-2 items-center">
          <input className={`${t.input} !w-28 uppercase font-semibold`} maxLength={4} value={prefix} aria-label="Code letters for this PC"
            onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          <span className={t.muted}>-ANA-PAN50-500</span>
          <button className={t.btnGhost} disabled={!prefix || prefix === prefixSaved} onClick={async () => {
            const r: any = await (window as any).api?.sku?.setPrefix?.(prefix, user?.id);
            if (r?.ok) { setPrefixSaved(r.data); toast.success(`New codes on this PC will start ${r.data}-`); }
            else toast.error(r?.message || 'Could not save');
          }}>Save</button>
        </div>
      </div>

      <p className={`mt-5 text-xs ${t.faint}`}>
        {MEDICINE_CATS.length + SHOP_CATS.length} built in · {cats.custom.length} added by you · "Other" is always there for anything that fits nowhere.
      </p>
    </div>
  );
}
