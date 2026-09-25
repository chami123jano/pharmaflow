import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { lkr, expiryState } from '../lib/format';
import { Spinner, Empty, ErrorNote, Pill, Stat } from '../components/ui';

interface Product { id: string; name: string; price: number; stock: number; category: string | null }
interface Batch {
  id: string; product_id: string; batch_no: string | null;
  expiry: string | null; qty_remaining: number;
}

type Tab = 'low' | 'expiring';

export default function Stock() {
  const [tab, setTab] = useState<Tab>('low');
  const [products, setProducts] = useState<Product[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [p, b] = await Promise.all([
      supabase.from('products').select('id,name,price,stock,category').order('stock'),
      supabase.from('product_batches').select('id,product_id,batch_no,expiry,qty_remaining').gt('qty_remaining', 0),
    ]);
    if (p.error) { setError(p.error.message); return; }
    if (b.error) { setError(b.error.message); return; }
    setProducts(p.data as Product[]);
    setBatches(b.data as Batch[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorNote error={error} onRetry={load} />;
  if (!products) return <Spinner label="Counting the shelves…" />;

  const byId = new Map(products.map((p) => [p.id, p]));
  const out = products.filter((p) => p.stock <= 0);
  const low = products.filter((p) => p.stock > 0 && p.stock < 10);
  // Value at retail, which is what the shelf is worth if it all sells.
  const value = products.reduce((a, p) => a + Number(p.price || 0) * Number(p.stock || 0), 0);

  const dated = batches
    .filter((b) => b.expiry)
    .map((b) => ({ ...b, state: expiryState(b.expiry), days: Math.round((new Date(b.expiry!).getTime() - Date.now()) / 86_400_000) }))
    .filter((b) => b.days <= 120)
    .sort((a, b) => a.days - b.days);

  const expired = dated.filter((b) => b.days < 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Stock</h1>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Shelf value" value={lkr(value)} sub={`${products.length} products`} />
        <Stat
          label="Needs attention"
          value={String(out.length + low.length + expired.length)}
          sub={`${out.length} out · ${low.length} low · ${expired.length} expired`}
          tone={out.length + expired.length > 0 ? 'text-red-600' : undefined}
        />
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('low')}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition ${tab === 'low' ? 'bg-blue-600 text-white' : 'card muted'}`}>
          Running out ({out.length + low.length})
        </button>
        <button onClick={() => setTab('expiring')}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition ${tab === 'expiring' ? 'bg-blue-600 text-white' : 'card muted'}`}>
          Expiring ({dated.length})
        </button>
      </div>

      {tab === 'low' ? (
        out.length + low.length === 0 ? (
          <Empty icon="✅" title="Nothing is running out" body="Every product has ten or more in hand." />
        ) : (
          <ul className="space-y-2">
            {[...out, ...low].map((p) => (
              <li key={p.id} className="card flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="faint truncate text-xs">{p.category || 'Uncategorised'}</p>
                </div>
                {p.stock <= 0
                  ? <Pill tone="bad">Out of stock</Pill>
                  : <Pill tone="warn">{p.stock} left</Pill>}
              </li>
            ))}
          </ul>
        )
      ) : dated.length === 0 ? (
        <Empty icon="📅" title="Nothing expiring soon" body="No batch is within four months of its expiry date." />
      ) : (
        <>
          <p className="muted text-xs">
            Soonest first — which is the order the till sells them in, so these are the ones moving next.
          </p>
          <ul className="space-y-2">
            {dated.map((b) => {
              const p = byId.get(b.product_id);
              return (
                <li key={b.id} className="card flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p?.name || 'Unknown product'}</p>
                    <p className="faint truncate text-xs">
                      {b.batch_no ? `Batch ${b.batch_no} · ` : ''}{b.qty_remaining} in this batch
                    </p>
                  </div>
                  <Pill tone={b.state.tone}>{b.state.label}</Pill>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
