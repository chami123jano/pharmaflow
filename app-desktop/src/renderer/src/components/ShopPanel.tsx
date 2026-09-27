import { useEffect, useState } from 'react';
import { useToast } from './Toast';
import { ui } from '../lib/ui';
import { useShop, DEFAULT_SHOP, type Mark } from '../lib/shop';
import Logo from './Logo';

/**
 * Where the shop says who it is.
 *
 * These five values are the only place the pharmacy's name exists. Everything
 * else — the header, the login screen, the receipt, the window title — reads
 * them. Leave them alone and the software runs under its own name, which is
 * what a fresh copy should do.
 */
export default function ShopPanel({ darkMode }: { darkMode?: boolean }) {
  const toast = useToast();
  const t = ui(darkMode);
  const shop = useShop();

  const [f, setF] = useState({ name: '', address: '', phone: '', regno: '', footer: '' });
  const [mark, setMark] = useState<Mark>('cross');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Seed from the live values once they have loaded, but never stamp over
  // something the owner is halfway through typing.
  useEffect(() => {
    if (dirty) return;
    setF({
      name: shop.name === DEFAULT_SHOP.name ? '' : shop.name,
      address: shop.address, phone: shop.phone, regno: shop.regno,
      footer: shop.footer === DEFAULT_SHOP.footer ? '' : shop.footer,
    });
    setMark(shop.mark);
  }, [shop.name, shop.address, shop.phone, shop.regno, shop.footer, shop.mark, dirty]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setDirty(true);
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  };

  async function save() {
    setBusy(true);
    const pairs: [string, string][] = [
      ['pharmacy.name', f.name.trim()],
      ['pharmacy.address', f.address.trim()],
      ['pharmacy.phone', f.phone.trim()],
      ['pharmacy.regno', f.regno.trim()],
      ['pharmacy.footer', f.footer.trim()],
      ['pharmacy.logo', mark],
    ];
    for (const [k, v] of pairs) await window.api?.settings?.set?.(k, v);
    setBusy(false);
    setDirty(false);
    toast.success('Shop details saved');
    // The header and every open screen pick this up without a restart.
    try { window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'settings' } })); } catch {}
  }

  const preview = f.name.trim() || DEFAULT_SHOP.name;

  return (
    <div className={`${t.card} p-5`}>
      <h2 className={`text-lg font-bold ${t.page}`}>Shop details</h2>
      <p className={`text-sm mb-4 ${t.muted}`}>
        Printed on every receipt and shown across the app. Leave the name blank to run under the
        software's own name.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className={t.label}>Shop name</label>
          <input className={t.input} value={f.name} onChange={set('name')} placeholder={DEFAULT_SHOP.name} />
        </div>
        <div className="md:col-span-2">
          <label className={t.label}>Address</label>
          <input className={t.input} value={f.address} onChange={set('address')} placeholder="No. 12, Main Street, Kandy" />
        </div>
        <div>
          <label className={t.label}>Phone</label>
          <input className={t.input} value={f.phone} onChange={set('phone')} placeholder="081 222 3344" />
        </div>
        <div>
          <label className={t.label}>Registration no.</label>
          <input className={t.input} value={f.regno} onChange={set('regno')} placeholder="NMRA / PHA 0000" />
        </div>
        <div className="md:col-span-2">
          <label className={t.label}>Footer line on the bill</label>
          <input className={t.input} value={f.footer} onChange={set('footer')} placeholder={DEFAULT_SHOP.footer} />
        </div>
      </div>

      <div className="mt-4">
        <label className={t.label}>Logo</label>
        <div className="flex gap-3">
          {(['capsule', 'cross'] as Mark[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setDirty(true); setMark(m); }}
              className={`flex-1 flex items-center gap-3 p-3 rounded-xl border-2 transition text-left ${
                mark === m ? 'border-blue-500 ring-2 ring-blue-500/25' : t.dark ? 'border-slate-700' : 'border-slate-200'
              }`}
            >
              <Logo size={40} mark={m} className="shrink-0" />
              <span className={`text-sm font-semibold ${t.page}`}>
                {m === 'capsule' ? 'Capsule' : 'Cross'}
                <span className={`block text-xs font-normal ${t.muted}`}>
                  {m === 'capsule' ? 'Curved into a C' : 'Plain pharmacy mark'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={`${t.well} mt-4 p-3 flex items-center gap-3`}>
        <Logo size={44} mark={mark} className="shrink-0" />
        <div className="min-w-0">
        <p className={`text-xs ${t.faint}`}>The bill will be headed</p>
        <p className={`font-bold ${t.page}`}>{preview}</p>
        {(f.address || f.phone) && (
          <p className={`text-xs ${t.muted}`}>{[f.address, f.phone && 'Tel: ' + f.phone].filter(Boolean).join(' · ')}</p>
        )}
        </div>
      </div>

      <button onClick={save} disabled={busy} className={`${t.btnPrimary} mt-4`}>
        {busy ? 'Saving…' : 'Save shop details'}
      </button>
    </div>
  );
}
