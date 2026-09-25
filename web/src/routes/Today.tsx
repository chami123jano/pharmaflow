import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { lkr, time, startOfDay } from '../lib/format';
import { Spinner, Empty, ErrorNote, Stat, Pill } from '../components/ui';

interface Sale {
  id: string;
  receipt_no: number | null;
  total: number;
  discount_amount: number;
  payment_method: string | null;
  cashier_name: string | null;
  voided_at: string | null;
  created_at: string;
}
interface Item {
  id: string; sale_id: string; product_name: string | null;
  quantity: number; unit_price: number; line_total: number;
}

export default function Today() {
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const since = useRef(startOfDay());

  const load = useCallback(async () => {
    setError(null);
    const { data, error } = await supabase
      .from('sales')
      .select('id,receipt_no,total,discount_amount,payment_method,cashier_name,voided_at,created_at')
      .gte('created_at', since.current)
      .order('created_at', { ascending: false });
    if (error) { setError(error.message); return; }
    setSales(data as Sale[]);

    const { data: dev } = await supabase
      .from('devices').select('last_seen_at').order('last_seen_at', { ascending: false }).limit(1);
    setLastSeen(dev?.[0]?.last_seen_at ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Watch for sales arriving rather than polling.
   *
   * The row only reaches here after the till has synced, so "live" means live
   * to the last sync, not to the last keystroke. A refresh on reconnect covers
   * anything that landed while the socket was down.
   */
  useEffect(() => {
    const ch = supabase
      .channel('sales-today')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, (payload) => {
        const row = payload.new as Sale;
        if (row.created_at < since.current) return;
        setSales((prev) => (prev && prev.some((s) => s.id === row.id) ? prev : [row, ...(prev || [])]));
        setFresh((prev) => new Set(prev).add(row.id));
        setLastSeen(new Date().toISOString());
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sales' }, (payload) => {
        const row = payload.new as Sale;
        setSales((prev) => prev?.map((s) => (s.id === row.id ? { ...s, ...row } : s)) ?? prev);
      })
      .subscribe();

    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (items[id]) return;
    const { data } = await supabase
      .from('sale_items').select('id,sale_id,product_name,quantity,unit_price,line_total').eq('sale_id', id);
    if (data) setItems((prev) => ({ ...prev, [id]: data as Item[] }));
  }

  if (error) return <ErrorNote error={error} onRetry={load} />;
  if (!sales) return <Spinner label="Loading today…" />;

  // A voided sale stays visible — it happened — but never counts as money.
  const live = sales.filter((s) => !s.voided_at);
  const takings = live.reduce((a, s) => a + Number(s.total || 0), 0);
  const discounts = live.reduce((a, s) => a + Number(s.discount_amount || 0), 0);
  const voided = sales.length - live.length;
  const average = live.length ? takings / live.length : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">Today</h1>
        <SyncAge iso={lastSeen} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Takings" value={lkr(takings)} sub={`${live.length} sale${live.length === 1 ? '' : 's'}`} />
        <Stat label="Average sale" value={lkr(average)} sub={discounts > 0 ? `${lkr(discounts)} discounted` : 'No discounts'} />
      </div>

      {voided > 0 && (
        <p className="muted text-xs">
          {voided} voided sale{voided === 1 ? '' : 's'} today — not counted above.
        </p>
      )}

      {live.length === 0 && voided === 0 ? (
        <Empty
          icon="🧾"
          title="Nothing sold yet today"
          body="Sales appear here shortly after the till syncs. If the shop PC is off, the last sync is all this can show."
        />
      ) : (
        <ul className="space-y-2">
          {sales.map((s) => (
            <li key={s.id} className={`card overflow-hidden ${fresh.has(s.id) ? 'flash' : ''}`}>
              <button onClick={() => toggle(s.id)} className="flex w-full items-center gap-3 p-3.5 text-left">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">#{s.receipt_no ?? '—'}</span>
                    {s.voided_at && <Pill tone="bad">Voided</Pill>}
                    {s.payment_method && <Pill tone="none">{s.payment_method}</Pill>}
                  </div>
                  <p className="faint mt-0.5 truncate text-xs">
                    {time(s.created_at)}{s.cashier_name ? ` · ${s.cashier_name}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-bold ${s.voided_at ? 'faint line-through' : ''}`}>{lkr(s.total)}</p>
                  {Number(s.discount_amount) > 0 && (
                    <p className="text-[11px] font-semibold text-amber-600">−{lkr(s.discount_amount)}</p>
                  )}
                </div>
                <span className={`faint text-xs transition ${openId === s.id ? 'rotate-90' : ''}`}>›</span>
              </button>

              {openId === s.id && (
                <div className="border-t px-3.5 py-3" style={{ borderColor: 'var(--border)' }}>
                  {!items[s.id] ? (
                    <p className="faint text-xs">Loading…</p>
                  ) : items[s.id].length === 0 ? (
                    <p className="faint text-xs">No line items recorded.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {items[s.id].map((i) => (
                        <li key={i.id} className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">
                            <span className="muted font-semibold">{i.quantity}×</span> {i.product_name || 'Unknown item'}
                          </span>
                          <span className="shrink-0 font-medium">{lkr(i.line_total)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Says how stale this view is, because that is the honest thing to show. */
function SyncAge({ iso }: { iso: string | null }) {
  if (!iso) return <Pill tone="none">Never synced</Pill>;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return <Pill tone="ok">Live</Pill>;
  if (mins < 60) return <Pill tone="ok">{mins}m ago</Pill>;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return <Pill tone="warn">{hrs}h ago</Pill>;
  return <Pill tone="warn">{Math.round(hrs / 24)}d ago</Pill>;
}
