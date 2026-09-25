import { useState, useEffect } from 'react';
import { formatLKR } from '../lib/format';

type Stat = { label: string; value: string | number; sub?: string; color: string; bg: string; icon: string };

function StatCard({ label, value, sub, color, bg, icon }: Stat) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex items-start gap-4 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center text-lg font-bold ${color} shrink-0`}>{icon}</div>
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

  const maxTrend = Math.max(...trend.map(d => d.value), 1);
  const dm = darkMode;
  const pageBg = dm ? 'bg-gray-900' : 'bg-gray-50';
  const cardBg = dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100';
  const textPrimary = dm ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = dm ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className={`space-y-6 ${pageBg}`}>
      {/* Welcome banner */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white shadow-lg">
        <h1 className="text-2xl font-bold">Welcome back, {user?.name || 'Admin'}!</h1>
        <p className="text-blue-100 mt-1 text-sm">Here is what is happening at your pharmacy today.</p>
        <div className="flex gap-3 mt-4">
          <button onClick={() => onQuickNav?.('sales')} className="px-4 py-2 bg-white text-blue-600 rounded-lg text-sm font-semibold hover:bg-blue-50 transition-colors">New Sale</button>
          <button onClick={() => onQuickNav?.('inventory')} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-400 transition-colors">Add Product</button>
          <button onClick={() => onQuickNav?.('reports')} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-400 transition-colors">Reports</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Products" value={stats.totalProducts ?? 0} icon="Rx" color="text-blue-600" bg="bg-blue-50" />
        <StatCard label="Low Stock Items" value={stats.lowStock ?? 0} sub="Need reorder" icon="!" color="text-orange-600" bg="bg-orange-50" />
        <StatCard label="Sales Today" value={formatLKR(stats.salesTotal ?? 0)} sub={`${stats.transactions ?? 0} transactions`} icon="Rs" color="text-green-600" bg="bg-green-50" />
        <StatCard label="Expiring Soon" value={stats.nearExpiry ?? 0} sub="Within 30 days" icon="Ex" color="text-red-600" bg="bg-red-50" />
      </div>

      {/* Charts + Alerts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales trend */}
        <div className={`lg:col-span-2 ${cardBg} border rounded-2xl p-6 shadow-sm`}>
          <h2 className={`text-base font-semibold ${textPrimary} mb-4`}>Sales Trend - Last 7 Days</h2>
          {trend.length === 0 ? (
            <div className={`flex items-center justify-center h-40 ${textSecondary} text-sm`}>No sales data yet. Start by adding products and making a sale.</div>
          ) : (
            <div className="flex items-end gap-2 h-40">
              {trend.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-blue-500 rounded-t-md opacity-80 hover:opacity-100 transition-opacity"
                    style={{ height: `${Math.max(4, (d.value / maxTrend) * 120)}px` }}
                    title={`${d.date}: ${formatLKR(d.value)}`}
                  />
                  <span className={`text-xs ${textSecondary}`}>{d.date?.slice(5)}</span>
                </div>
              ))}
            </div>
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

      {/* Recent sales */}
      <div className={`${cardBg} border rounded-2xl p-6 shadow-sm`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-base font-semibold ${textPrimary}`}>Recent Sales</h2>
          <button onClick={() => onQuickNav?.('reports')} className="text-xs text-blue-600 hover:underline">View all</button>
        </div>
        {recent.length === 0 ? (
          <div className={`text-center py-8 ${textSecondary} text-sm`}>No sales yet. Go to Sales to start billing.</div>
        ) : (
          <div className="overflow-x-auto">
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