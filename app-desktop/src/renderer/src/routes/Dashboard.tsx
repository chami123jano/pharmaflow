import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { formatLKR, formatLKRShort } from '../lib/format';

type Stat = { label: string; value: string | number; sub?: string; color: string; bg: string; icon: ReactNode };


/* Line icons, 24px grid, inheriting the card's colour. Drawn inline rather
   than pulled from a font so nothing has to load before they appear. */
const svg = (children: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const IconBox = () => svg(<><path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></>);
const IconAlert = () => svg(<><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></>);
const IconReceipt = () => svg(<><path d="M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5z"/><path d="M8 7h8M8 11h8M8 15h5"/></>);
const IconClock = () => svg(<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>);

function StatCard({ label, value, sub, color, bg, icon }: Stat) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-4 flex items-start gap-4 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center ${color} shrink-0`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function Dashboard({ user, tokens, onQuickNav, darkMode }: { user: any; tokens?: any; onQuickNav?: (k: string) => void; darkMode?: boolean }) {
  const [stats, setStats]   = useState<any>({});
  const [trend, setTrend]   = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [lowStock, setLow]  = useState<any[]>([]);
  const [expiring, setExp]  = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchAll() {
    setLoading(true);
    try {
      const [sumRes, trendRes, lowRes, nearRes, salesRes] = await Promise.all([
        window.api?.sales?.summaryToday?.(),
        window.api?.reports?.salesTrend?.('week'),
        window.api?.reports?.lowStock?.(10),
        window.api?.reports?.nearExpiry?.(30),
        window.api?.sales?.list?.(5),
      ]);
      const productsRes = await window.api?.products?.list?.();

      setStats({
        salesTotal: sumRes?.data?.totalSales ?? 0,
        transactions: sumRes?.data?.transactions ?? 0,
        totalProducts: (productsRes?.data ?? []).length,
        lowStock: (lowRes?.data ?? []).length,
        nearExpiry: (nearRes?.data ?? []).length,
      });
      setTrend(trendRes?.data ?? []);
      setRecent((salesRes?.data ?? []).slice(0, 8));
      setLow((lowRes?.data ?? []).slice(0, 5));
      setExp((nearRes?.data ?? []).slice(0, 5));
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    fetchAll();
    const h = () => fetchAll();
    window.addEventListener('ph:sale:completed', h);
    window.addEventListener('ph:refresh', h);
    const t = setInterval(fetchAll, 30000);
    return () => { window.removeEventListener('ph:sale:completed', h); window.removeEventListener('ph:refresh', h); clearInterval(t); };
  }, []);

  /**
   * Seven columns, always.
   *
   * The report returns only the days that had a sale, and a flex row given one
   * entry stretched it across the whole card — a single slab of blue that read
   * as a bug rather than a quiet week. Padding the gaps with zeroes shows the
   * shape of the week honestly.
   */
  const week = useMemo(() => {
    const byDate = new Map(trend.map((d: any) => [String(d.date).slice(0, 10), Number(d.value) || 0]));
    const out: { date: string; value: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ date: key, value: byDate.get(key) ?? 0 });
    }
    return out;
  }, [trend]);

  const maxTrend = Math.max(...week.map((d) => d.value), 1);
  const weekTotal = week.reduce((a, d) => a + d.value, 0);
  const dm = darkMode;
  const pageBg = dm ? 'bg-gray-900' : 'bg-gray-50';
  const cardBg = dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100';
  const textPrimary = dm ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = dm ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className={`flex flex-col gap-4 lg:h-[calc(100vh-7.5rem)] ${pageBg}`}>
      {/* Welcome banner */}
      {/* A greeting and three shortcuts took a sixth of the screen. Same
          content, one row. */}
      <div className="shrink-0 bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl px-5 py-3.5 text-white shadow-lg flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold leading-tight">Welcome back, {user?.name || 'Admin'}</h1>
          <p className="text-blue-100 text-xs">Here is what is happening at your pharmacy today.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onQuickNav?.('sales')} className="px-3.5 py-2 bg-white text-blue-600 rounded-lg text-sm font-semibold hover:bg-blue-50 transition-colors">New Sale</button>
          <button onClick={() => onQuickNav?.('inventory')} className="px-3.5 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-400 transition-colors">Add Product</button>
          <button onClick={() => onQuickNav?.('reports')} className="px-3.5 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-400 transition-colors">Reports</button>
        </div>
      </div>

      {/* Stats */}
      <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Products" value={stats.totalProducts ?? 0} icon={<IconBox />} color="text-blue-600" bg="bg-blue-50" />
        <StatCard label="Low Stock Items" value={stats.lowStock ?? 0} sub="Need reorder" icon={<IconAlert />} color="text-orange-600" bg="bg-orange-50" />
        <StatCard label="Sales Today" value={formatLKR(stats.salesTotal ?? 0)} sub={`${stats.transactions ?? 0} transactions`} icon={<IconReceipt />} color="text-green-600" bg="bg-green-50" />
        <StatCard label="Expiring Soon" value={stats.nearExpiry ?? 0} sub="Within 30 days" icon={<IconClock />} color="text-red-600" bg="bg-red-50" />
      </div>

      {/* Charts + Alerts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales trend */}
        <div className={`lg:col-span-2 ${cardBg} border rounded-2xl p-6 shadow-sm`}>
          <h2 className={`text-base font-semibold ${textPrimary} mb-4`}>Sales Trend - Last 7 Days</h2>
          <div className="flex items-end gap-3 h-40">
            {week.map((d) => {
              const pct = (d.value / maxTrend) * 100;
              const day = new Date(d.date + 'T00:00:00');
              const today = d.date === week[week.length - 1].date;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-2 h-full justify-end"
                  title={`${day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} — ${formatLKR(d.value)}`}>
                  {d.value > 0 && (
                    <span className={`text-[10px] font-semibold ${textSecondary}`}>{formatLKRShort(d.value)}</span>
                  )}
                  <div className={`w-full rounded-t-lg transition-all duration-500 ${
                    d.value === 0
                      ? (darkMode ? 'bg-slate-700/60' : 'bg-slate-100')
                      : today ? 'bg-blue-600' : 'bg-blue-400'
                  }`} style={{ height: d.value === 0 ? '4px' : `${Math.max(6, pct)}%` }} />
                  <span className={`text-[11px] ${today ? 'font-bold ' + textPrimary : textSecondary}`}>
                    {day.toLocaleDateString('en-GB', { weekday: 'short' })}
                  </span>
                </div>
              );
            })}
          </div>
          {weekTotal === 0 && (
            <p className={`text-xs mt-3 text-center ${textSecondary}`}>
              Nothing sold in the last seven days.
            </p>
          )}
        </div>

        {/* Alerts */}
        <div className="space-y-4">
          {/* Low stock alert */}
          <div className={`${cardBg} border rounded-2xl p-5 shadow-sm`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>Low Stock Alert</h3>
            {lowStock.length === 0 ? (
              <p className={`text-xs ${textSecondary}`}>All products are well stocked.</p>
            ) : (
              <div className="space-y-2">
                {lowStock.map(p => (
                  <div key={p.id} className="flex items-center justify-between">
                    <span className={`text-xs ${textPrimary} truncate max-w-32`}>{p.name}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                      {p.stock === 0 ? 'Out' : `x${p.stock}`}
                    </span>
                  </div>
                ))}
                <button onClick={() => onQuickNav?.('inventory')} className="text-xs text-blue-600 hover:underline mt-1">View all</button>
              </div>
            )}
          </div>

          {/* Expiring soon */}
          <div className={`${cardBg} border rounded-2xl p-5 shadow-sm`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>Expiring Soon</h3>
            {expiring.length === 0 ? (
              <p className={`text-xs ${textSecondary}`}>No products expiring in 30 days.</p>
            ) : (
              <div className="space-y-2">
                {expiring.map(p => (
                  <div key={p.id} className="flex items-center justify-between">
                    <span className={`text-xs ${textPrimary} truncate max-w-32`}>{p.name}</span>
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">{p.expiry?.slice(0, 7)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent sales — takes the remaining height so the page never scrolls */}
      <div className={`${cardBg} border rounded-2xl px-5 py-4 shadow-sm flex-1 min-h-0 flex flex-col`}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className={`text-base font-semibold ${textPrimary}`}>Recent Sales</h2>
          <button onClick={() => onQuickNav?.('reports')} className="text-xs text-blue-600 hover:underline">View all</button>
        </div>
        {recent.length === 0 ? (
          <div className={`flex-1 grid place-items-center ${textSecondary} text-sm`}>No sales yet. Go to Sales to start billing.</div>
        ) : (
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${dm ? 'border-gray-700' : 'border-gray-100'}`}>
                  <th className={`text-left py-2 font-medium ${textSecondary}`}>Receipt #</th>
                  <th className={`text-left py-2 font-medium ${textSecondary}`}>Date</th>
                  <th className={`text-left py-2 font-medium ${textSecondary}`}>Payment</th>
                  <th className={`text-right py-2 font-medium ${textSecondary}`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s: any) => (
                  <tr key={s.id} className={`border-b ${dm ? 'border-gray-700' : 'border-gray-50'} hover:${dm ? 'bg-gray-700' : 'bg-gray-50'}`}>
                    <td className={`py-2 font-mono text-xs ${textSecondary}`}>#{s.receipt_no || s.id?.slice(0, 8)}</td>
                    <td className={`py-2 text-xs ${textSecondary}`}>{new Date(s.created_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</td>
                    <td className="py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${s.payment_method === 'cash' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{s.payment_method?.toUpperCase()}</span></td>
                    <td className={`py-2 text-right font-semibold text-green-600`}>{formatLKR(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}