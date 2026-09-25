import { useState, useEffect } from 'react';
import { formatLKR } from '../lib/format';

const RANGES = [
  { value:'today', label:'Today' },
  { value:'week',  label:'This Week' },
  { value:'month', label:'This Month' },
  { value:'quarter',label:'This Quarter' },
  { value:'year',  label:'This Year' },
];

function SummaryCard({ label, value, sub, color }: { label:string; value:string|number; sub?:string; color:string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <p className="text-sm text-gray-500 font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function Reports({ user, tokens, darkMode }: { user: any; tokens?: any; darkMode?: boolean }) {
  const [range, setRange]       = useState('week');
  const [reportType, setType]   = useState('sales');
  const [summary, setSummary]   = useState<any>({});
  const [trend, setTrend]       = useState<any[]>([]);
  const [topProducts, setTop]   = useState<any[]>([]);
  const [lowStock, setLow]      = useState<any[]>([]);
  const [nearExpiry, setNear]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);

  useEffect(() => { fetchData(); }, [range, reportType]);

  async function fetchData() {
    setLoading(true);
    try {
      if (reportType === 'sales' || reportType === 'top') {
        const [sumRes, trendRes, topRes] = await Promise.all([
          window.api?.reports?.salesSummary?.(range),
          window.api?.reports?.salesTrend?.(range),
          window.api?.reports?.topProducts?.(range),
        ]);
        setSummary(sumRes?.data ?? {});
        setTrend(trendRes?.data ?? []);
        setTop(topRes?.data ?? []);
      } else if (reportType === 'lowstock') {
        const res = await window.api?.reports?.lowStock?.(10);
        setLow(res?.data ?? []);
      } else if (reportType === 'expiry') {
        const res = await window.api?.reports?.nearExpiry?.(30);
        setNear(res?.data ?? []);
      }
    } catch {}
    setLoading(false);
  }

  async function exportCSV() {
    try {
      let csv = '';
      if (reportType === 'sales') {
        csv = 'Date,Amount,Transactions\n' + trend.map(d => `${d.date},${d.value},${d.transactions}`).join('\n');
      } else if (reportType === 'top') {
        csv = 'Product,SKU,Qty Sold,Revenue\n' + topProducts.map(p => `${p.name},${p.sku},${p.total_qty},${p.total_revenue}`).join('\n');
      } else if (reportType === 'lowstock') {
        csv = 'Product,SKU,Stock\n' + lowStock.map(p => `${p.name},${p.sku},${p.stock}`).join('\n');
      } else {
        csv = 'Product,SKU,Expiry\n' + nearExpiry.map(p => `${p.name},${p.sku},${p.expiry}`).join('\n');
      }
      const fname = `pharmaflow-${reportType}-${range}-${new Date().toISOString().slice(0,10)}.csv`;
      await window.api?.util?.exportCSV?.(fname, csv);
    } catch {}
  }

  const maxTrend = Math.max(...trend.map(d => d.value), 1);
  const dm = darkMode;
  const card = `bg-white rounded-2xl border ${dm ? 'bg-gray-800 border-gray-700' : 'border-gray-100'} shadow-sm p-6`;
  const tp = dm ? 'text-gray-100' : 'text-gray-900';
  const ts = dm ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${tp}`}>Reports & Analytics</h1>
          <p className={`text-sm mt-0.5 ${ts}`}>Track your pharmacy performance and insights</p>
        </div>
        <button onClick={exportCSV} className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors shadow">
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className={`${card} !p-4`}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${ts}`}>Report Type</label>
            <select value={reportType} onChange={e => setType(e.target.value)}
              className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${dm ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}>
              <option value="sales">Sales Report</option>
              <option value="top">Top Products</option>
              <option value="lowstock">Low Stock Report</option>
              <option value="expiry">Near Expiry Report</option>
            </select>
          </div>
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1.5 ${ts}`}>Date Range</label>
            <select value={range} onChange={e => setRange(e.target.value)}
              className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${dm ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}>
              {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading && <div className={`text-center py-8 ${ts}`}>Loading...</div>}

      {/* Sales Summary */}
      {reportType === 'sales' && !loading && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard label="Total Sales" value={formatLKR(summary.totalSales ?? 0)} color="text-green-600" />
            <SummaryCard label="Transactions" value={summary.totalTransactions ?? 0} color="text-blue-600" />
            <SummaryCard label="Avg Transaction" value={formatLKR(summary.averageTransaction ?? 0)} color="text-purple-600" />
            <SummaryCard label="Total Discount" value={formatLKR(summary.totalDiscount ?? 0)} color="text-orange-600" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sales Trend */}
            <div className={card}>
              <h3 className={`text-sm font-semibold ${tp} mb-4`}>Sales Trend</h3>
              {trend.length === 0 ? (
                <div className={`flex items-center justify-center h-40 ${ts} text-sm`}>No sales in this period</div>
              ) : (
                <div className="flex items-end gap-1 h-40">
                  {trend.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 pointer-events-none">
                        {formatLKR(d.value)}
                      </div>
                      <div className="w-full bg-blue-500 rounded-t-sm transition-all hover:bg-blue-600"
                        style={{ height: `${Math.max(4, (d.value / maxTrend) * 120)}px` }} />
                      <span className={`text-xs ${ts} truncate w-full text-center`}>{d.date?.slice(5)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Daily table */}
            <div className={card}>
              <h3 className={`text-sm font-semibold ${tp} mb-4`}>Daily Breakdown</h3>
              <div className="overflow-auto max-h-48">
                <table className="w-full text-xs">
                  <thead><tr className={`border-b ${dm ? 'border-gray-700' : 'border-gray-100'}`}>
                    <th className={`text-left py-1.5 ${ts}`}>Date</th>
                    <th className={`text-right py-1.5 ${ts}`}>Sales</th>
                    <th className={`text-right py-1.5 ${ts}`}>Txns</th>
                  </tr></thead>
                  <tbody>
                    {trend.map((d, i) => (
                      <tr key={i} className={`border-b ${dm ? 'border-gray-700' : 'border-gray-50'}`}>
                        <td className={`py-1.5 ${tp}`}>{d.date}</td>
                        <td className={`py-1.5 text-right font-medium text-green-600`}>{formatLKR(d.value)}</td>
                        <td className={`py-1.5 text-right ${ts}`}>{d.transactions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Top Products */}
      {reportType === 'top' && !loading && (
        <div className={card}>
          <h3 className={`text-sm font-semibold ${tp} mb-4`}>Top Selling Products</h3>
          {topProducts.length === 0 ? (
            <div className={`text-center py-8 ${ts} text-sm`}>No sales data in this period</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className={`border-b ${dm ? 'border-gray-700' : 'border-gray-100'}`}>
                <th className={`text-left py-2 font-medium ${ts}`}>Product</th>
                <th className={`text-center py-2 font-medium ${ts}`}>SKU</th>
                <th className={`text-right py-2 font-medium ${ts}`}>Qty Sold</th>
                <th className={`text-right py-2 font-medium ${ts}`}>Revenue</th>
              </tr></thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={p.id} className={`border-b ${dm ? 'border-gray-700' : 'border-gray-50'}`}>
                    <td className={`py-2 ${tp}`}><span className="inline-block w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold text-center leading-6 mr-2">{i+1}</span>{p.name}</td>
                    <td className={`py-2 text-center font-mono text-xs ${ts}`}>{p.sku}</td>
                    <td className={`py-2 text-right font-bold text-blue-600`}>{p.total_qty}</td>
                    <td className={`py-2 text-right font-bold text-green-600`}>{formatLKR(p.total_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Low Stock */}
      {reportType === 'lowstock' && !loading && (
        <div className={card}>
          <h3 className={`text-sm font-semibold ${tp} mb-4`}>Low Stock Products (10 units or less)</h3>
          {lowStock.length === 0 ? (
            <div className={`text-center py-8 text-green-600 font-medium`}>All products well stocked!</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className={`border-b ${dm ? 'border-gray-700' : 'border-gray-100'}`}>
                <th className={`text-left py-2 font-medium ${ts}`}>Product</th>
                <th className={`text-center py-2 font-medium ${ts}`}>SKU</th>
                <th className={`text-center py-2 font-medium ${ts}`}>Category</th>
                <th className={`text-right py-2 font-medium ${ts}`}>Stock</th>
                <th className={`text-right py-2 font-medium ${ts}`}>Price</th>
              </tr></thead>
              <tbody>
                {lowStock.map(p => (
                  <tr key={p.id} className={`border-b ${dm ? 'border-gray-700' : 'border-gray-50'}`}>
                    <td className={`py-2 font-medium ${tp}`}>{p.name}</td>
                    <td className={`py-2 text-center font-mono text-xs ${ts}`}>{p.sku}</td>
                    <td className={`py-2 text-center text-xs ${ts}`}>{p.category || '-'}</td>
                    <td className="py-2 text-right">
                      <span className={`font-bold px-2 py-0.5 rounded-full text-xs ${p.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                        {p.stock === 0 ? 'OUT' : p.stock}
                      </span>
                    </td>
                    <td className={`py-2 text-right ${tp}`}>{formatLKR(p.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Near Expiry */}
      {reportType === 'expiry' && !loading && (
        <div className={card}>
          <h3 className={`text-sm font-semibold ${tp} mb-4`}>Products Expiring Within 30 Days</h3>
          {nearExpiry.length === 0 ? (
            <div className="text-center py-8 text-green-600 font-medium">No products expiring soon!</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className={`border-b ${dm ? 'border-gray-700' : 'border-gray-100'}`}>
                <th className={`text-left py-2 font-medium ${ts}`}>Product</th>
                <th className={`text-center py-2 font-medium ${ts}`}>SKU</th>
                <th className={`text-right py-2 font-medium ${ts}`}>Stock</th>
                <th className={`text-right py-2 font-medium ${ts}`}>Expiry Date</th>
                <th className={`text-right py-2 font-medium ${ts}`}>Days Left</th>
              </tr></thead>
              <tbody>
                {nearExpiry.map(p => {
                  const days = Math.floor((new Date(p.expiry).getTime() - Date.now()) / 864e5);
                  return (
                    <tr key={p.id} className={`border-b ${dm ? 'border-gray-700' : 'border-gray-50'}`}>
                      <td className={`py-2 font-medium ${tp}`}>{p.name}</td>
                      <td className={`py-2 text-center font-mono text-xs ${ts}`}>{p.sku}</td>
                      <td className={`py-2 text-right ${ts}`}>{p.stock}</td>
                      <td className={`py-2 text-right ${ts}`}>{p.expiry?.slice(0,10)}</td>
                      <td className="py-2 text-right">
                        <span className={`font-bold px-2 py-0.5 rounded-full text-xs ${days < 0 ? 'bg-red-100 text-red-700' : days < 7 ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {days < 0 ? 'EXPIRED' : `${days}d`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}