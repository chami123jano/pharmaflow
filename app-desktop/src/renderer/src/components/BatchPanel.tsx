import { useState, useEffect, useCallback, useRef } from 'react';
import { formatLKR } from '../lib/format';
import { useToast } from './Toast';

interface Props {
  product: any;
  user?: any;
  darkMode?: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/** Days from today until the date, or null when there is no date. */
function daysLeft(expiry: string | null): number | null {
  if (!expiry) return null;
  const d = Date.parse(expiry.slice(0, 10));
  if (!Number.isFinite(d)) return null;
  return Math.round((d - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000);
}

/**
 * Receiving a delivery, and seeing what is on the shelf under which expiry
 * date. Each delivery is its own batch, so the same medicine can sit here
 * three times over with three different dates — and the counter always sells
 * the soonest-expiring one first.
 */
export default function BatchPanel({ product, user, darkMode, onClose, onChanged }: Props) {
  const toast = useToast();
  const [batches, setBatches] = useState<any[]>([]);
  const [qty, setQty] = useState('');
  const [expiry, setExpiry] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [cost, setCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r: any = await window.api?.batches?.list?.(product.id);
    if (r?.ok) setBatches(r.data || []);
  }, [product.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setTimeout(() => qtyRef.current?.focus(), 60); }, []);

  async function receive(e?: React.FormEvent) {
    e?.preventDefault();
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n <= 0) { toast.error('Enter how many arrived'); return; }
    setBusy(true);
    const r: any = await window.api?.batches?.receive?.({
      product_id: product.id,
      qty: n,
      expiry: expiry || undefined,
      batch_no: batchNo.trim() || undefined,
      cost_price: cost ? Number(cost) : undefined,
      supplier: supplier.trim() || undefined,
      created_by: user?.id,
    });
    setBusy(false);
    if (r?.ok) {
      toast.success(`${n} added${expiry ? ', expires ' + expiry : ''}`);
      setQty(''); setExpiry(''); setBatchNo(''); setCost('');
      load(); onChanged();
      setTimeout(() => qtyRef.current?.focus(), 40);
    } else {
      toast.error(r?.message || r?.error || 'Could not add the stock');
    }
  }

  const total = batches.reduce((s, b) => s + Number(b.qty_remaining || 0), 0);
  const live = batches.filter((b) => Number(b.qty_remaining) > 0);

  const dm = darkMode;
  const tp = dm ? 'text-gray-100' : 'text-gray-900';
  const ts = dm ? 'text-gray-400' : 'text-gray-500';
  const inp = `w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${dm ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`;
  const lbl = `block text-xs font-semibold uppercase tracking-wide mb-1 ${ts}`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col ${dm ? 'bg-gray-800' : 'bg-white'}`}>
        <div className={`p-5 border-b ${dm ? 'border-gray-700' : 'border-gray-200'}`}>
          <h2 className={`text-lg font-bold ${tp}`}>{product.name}</h2>
          <p className={`text-sm mt-0.5 ${ts}`}>
            {total} in stock across {live.length} batch{live.length === 1 ? '' : 'es'} · sold soonest-expiry first
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <form onSubmit={receive} className={`rounded-xl border p-4 ${dm ? 'border-gray-700 bg-gray-700/30' : 'border-gray-200 bg-gray-50'}`}>
            <h3 className={`text-sm font-bold mb-3 ${tp}`}>Receive a delivery</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className={lbl}>Quantity *</label>
                <input ref={qtyRef} className={inp} value={qty} inputMode="numeric"
                  onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} placeholder="100" />
              </div>
              <div>
                <label className={lbl}>Expiry</label>
                <input type="date" className={inp} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Batch no</label>
                <input className={inp} value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="from the box" />
              </div>
              <div>
                <label className={lbl}>Cost each</label>
                <input className={inp} value={cost} inputMode="decimal"
                  onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
              </div>
              <div>
                <label className={lbl}>Supplier</label>
                <input className={inp} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button type="submit" disabled={busy}
                className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50">
                {busy ? 'Adding…' : 'Add this delivery'}
              </button>
              <span className={`text-xs ${ts}`}>Each delivery is kept separately, so three dates can sit side by side.</span>
            </div>
          </form>

          <div>
            <h3 className={`text-sm font-bold mb-2 ${tp}`}>On the shelf</h3>
            {live.length === 0 ? (
              <p className={`text-sm py-6 text-center ${ts}`}>No stock yet. Add a delivery above.</p>
            ) : (
              <div className={`rounded-xl border overflow-hidden ${dm ? 'border-gray-700' : 'border-gray-200'}`}>
                <table className="w-full text-sm">
                  <thead className={dm ? 'bg-gray-700' : 'bg-gray-50'}>
                    <tr className={ts}>
                      <th className="text-left px-3 py-2">Sells</th>
                      <th className="text-left px-3 py-2">Expiry</th>
                      <th className="text-left px-3 py-2">Batch</th>
                      <th className="text-right px-3 py-2">Left</th>
                      <th className="text-right px-3 py-2">Cost</th>
                      <th className="text-left px-3 py-2">Supplier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((b, i) => {
                      const d = daysLeft(b.expiry);
                      const soon = d !== null && d >= 0 && d <= 90;
                      return (
                        <tr key={b.id} className={`border-t ${dm ? 'border-gray-700' : 'border-gray-100'} ${b.expired ? (dm ? 'bg-red-900/20' : 'bg-red-50') : ''}`}>
                          <td className={`px-3 py-2 font-bold ${ts}`}>{i + 1}{i === 0 ? ' ◀ next' : ''}</td>
                          <td className="px-3 py-2">
                            <span className={tp}>{b.expiry || '—'}</span>
                            {b.expired && <span className="ml-2 px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold">expired</span>}
                            {!b.expired && soon && <span className="ml-2 px-2 py-0.5 rounded-full bg-orange-400 text-white text-xs font-bold">{d}d</span>}
                          </td>
                          <td className={`px-3 py-2 ${ts}`}>{b.batch_no || '—'}</td>
                          <td className={`px-3 py-2 text-right font-bold ${tp}`}>{b.qty_remaining}</td>
                          <td className={`px-3 py-2 text-right ${ts}`}>{b.cost_price != null ? formatLKR(b.cost_price) : '—'}</td>
                          <td className={`px-3 py-2 ${ts}`}>{b.supplier || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {live.some((b) => b.expired) && (
              <p className="mt-2 text-xs text-red-500">
                Expired batches cannot be sold at the counter. An admin can still sell them if that is deliberate.
              </p>
            )}
          </div>
        </div>

        <div className={`flex gap-3 p-5 border-t ${dm ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose}
            className={`flex-1 py-2.5 rounded-xl border font-medium ${dm ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
