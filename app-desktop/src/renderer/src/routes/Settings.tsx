import React, { useEffect, useState } from 'react';
import SyncPanel from '../components/SyncPanel';
import LockdownPanel from '../components/LockdownPanel';
import ShopPanel from '../components/ShopPanel';

interface Setting { key:string; value:string }

export default function Settings({ user, tokens, darkMode }: { user?: any; tokens?: any; darkMode?: boolean }){
  const [items,setItems] = useState<Setting[]>([]);
  const [form,setForm] = useState<Setting>({ key:'', value:''});
  const [printers, setPrinters] = useState<Array<{ name:string; displayName?:string; isDefault?:boolean }>>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [silent, setSilent] = useState<boolean>(false);
  const [adminMsg, setAdminMsg] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  function load(){
    window.api.settings.list().then(r=>{
      if(r?.ok && Array.isArray(r.data)) setItems(r.data as Setting[]);
      else if(r?.ok) setItems([]);
    });
  }
  useEffect(()=>{ load(); },[]);
  useEffect(()=>{
    // Load printers
    (async () => {
      try {
        const list = await (window as any).api?.util?.listPrinters?.();
        setPrinters(Array.isArray(list) ? list : []);
      } catch {
        setPrinters([]);
      }
    })();
  },[]);

  useEffect(()=>{
    // Initialize printer settings from existing items
    const name = items.find(i=>i.key==='printer.receipt.name')?.value || '';
    const silentVal = (items.find(i=>i.key==='printer.receipt.silent')?.value || '').toLowerCase();
    setSelectedPrinter(name);
    setSilent(silentVal==='1' || silentVal==='true' || silentVal==='yes');
  },[items]);

  function save(){
    if(!form.key) return;
    window.api.settings.set(form.key, form.value).then(r=>{
      if(r?.ok){ setForm({key:'',value:''}); load(); }
    });
  }

  async function savePrinterSettings(){
    await window.api.settings.set('printer.receipt.name', selectedPrinter || '');
    await window.api.settings.set('printer.receipt.silent', silent ? '1' : '0');
    load();
  }

  async function testPrint(){
    const now = new Date();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body{margin:0;padding:20px;font-family:'Courier New',monospace;font-size:12px}
    .receipt{width:300px;margin:0 auto} .text-center{text-align:center} .my-2{margin:8px 0}
    table{width:100%;border-collapse:collapse} th,td{padding:2px 4px} th:last-child,td:last-child{text-align:right}
    </style></head><body><div class="receipt">
    <div class="text-center"><strong>Test Receipt</strong></div>
    <div class="my-2">Date: ${now.toLocaleString()}</div>
    <table><thead><tr><th>Item</th><th>Total</th></tr></thead><tbody>
  <tr><td>Printer Check</td><td>Rs 0.00</td></tr>
    </tbody></table>
    <div class="text-center my-2">-- End --</div>
    </div></body></html>`;
    try {
      const r = await (window as any).api?.util?.printHTML?.(html);
      if (r?.ok) alert('Test page sent to the printer');
      else if (r?.error === 'CANCELLED') alert('Printing was cancelled');
      else alert('Print failed: ' + (r?.message || 'unknown reason'));
    } catch (e: any) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? (e as any).message : String(e);
      alert('Print error: ' + msg);
    }
  }

  return (
    <div className="space-y-6">
      <ShopPanel darkMode={darkMode} />
      <LockdownPanel user={user} darkMode={darkMode} />
      <SyncPanel darkMode={darkMode} />
      <div>
        <h1 className="font-semibold text-lg mb-2">Settings</h1>
        <table className="w-full text-sm bg-white rounded shadow">
          <thead className="bg-gray-100 text-xs text-gray-500"><tr><th className="text-left p-2">Key</th><th className="text-left p-2">Value</th></tr></thead>
          <tbody>
            {items.map(s=>(<tr key={s.key} className="border-t"><td className="p-2">{s.key}</td><td className="p-2">{s.value}</td></tr>))}
            {!items.length && <tr><td colSpan={2} className="p-6 text-center text-gray-400">No settings</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded shadow p-4 w-[400px] space-y-2">
        <h2 className="font-medium text-sm">Add / Update Setting</h2>
        <input className="border rounded px-2 py-1 text-sm w-full" placeholder="Key" value={form.key} onChange={e=>setForm(f=>({...f,key:e.target.value}))} />
        <input className="border rounded px-2 py-1 text-sm w-full" placeholder="Value" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} />
        <div className="flex justify-end"><button onClick={save} className="bg-blue-600 text-white text-xs px-3 py-1 rounded">Save</button></div>
      </div>

      <div className="bg-white rounded shadow p-4 w-[400px] space-y-3">
        <h2 className="font-medium text-sm">Receipt Printer</h2>
        <label className="text-xs text-gray-600">Select printer</label>
  <select value={selectedPrinter} onChange={e=>setSelectedPrinter(e.target.value)} className="border rounded px-2 py-1 text-sm w-full" aria-label="Receipt printer" title="Receipt printer">
          <option value="">System default</option>
          {printers.map(p=> (
            <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' (Default)' : ''}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={silent} onChange={e=>setSilent(e.target.checked)} />
          Print silently (no dialog)
        </label>
        <div className="flex justify-end">
          <button onClick={savePrinterSettings} className="bg-green-600 text-white text-xs px-3 py-1 rounded">Save Printer Settings</button>
        </div>
        <div className="flex justify-end">
          <button onClick={testPrint} className="mt-2 bg-gray-700 text-white text-xs px-3 py-1 rounded">Test Print</button>
        </div>
      </div>

      <div className="bg-white rounded shadow p-4 w-[400px] space-y-3">
        <h2 className="font-medium text-sm">Admin Tools</h2>
        <div className="flex gap-2">
          <button
            onClick={async ()=>{
              setAdminMsg('');
              const res = await (window as any).api?.admin?.resetAllSales?.();
              if(res?.ok){
                setAdminMsg(`All sales reset. Restored items: ${res.data?.restoredProducts || 0}, Sales deleted: ${res.data?.salesDeleted || 0}`);
                try {
                  localStorage.setItem('ph:lastSaleTs', String(Date.now()));
                  window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'sales' } }));
                } catch {}
              } else {
                setAdminMsg(`Failed to reset: ${res?.error || 'Unknown error'}`);
              }
            }}
            className="bg-red-600 text-white text-xs px-3 py-1 rounded"
            title="Restore stock and delete all sales"
          >
            Reset All Sales
          </button>
          <button
            onClick={async ()=>{
              setAdminMsg('');
              const res = await (window as any).api?.admin?.seedCommonProductsLK?.();
              if(res?.ok){
                setAdminMsg(`Seeded common products. Inserted: ${res.data?.inserted || 0}, Skipped: ${res.data?.skipped || 0}`);
                try {
                  localStorage.setItem('ph:lastSaleTs', String(Date.now()));
                  window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'products' } }));
                } catch {}
              } else {
                setAdminMsg(`Failed to seed: ${res?.error || 'Unknown error'}`);
              }
            }}
            className="bg-blue-600 text-white text-xs px-3 py-1 rounded"
            title="Add common Sri Lankan medicines (name, category, SKU only)"
          >
            Seed Common Medicines (LK)
          </button>
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={async ()=>{
              try {
                setBusy(true); setAdminMsg('');
                const res = await (window as any).api?.admin?.backupDb?.();
                if(res?.ok){
                  setAdminMsg(`Backup saved to: ${res?.data?.filePath || 'selected location'}`);
                } else if(res?.error !== 'CANCELED') {
                  setAdminMsg(`Backup failed: ${res?.error || 'Unknown error'}`);
                }
              } finally { setBusy(false); }
            }}
            className="bg-gray-700 text-white text-xs px-3 py-1 rounded"
            title="Export a copy of the local database"
          >
            {busy ? 'Workingâ€¦' : 'Backup Database'}
          </button>
          <button
            disabled={busy}
            onClick={async ()=>{
              try {
                setBusy(true); setAdminMsg('');
                const res = await (window as any).api?.admin?.restoreDb?.();
                if(res?.ok){
                  setAdminMsg('Restore file staged. The app needs to restart to apply the backup.');
                } else if(res?.error !== 'CANCELED') {
                  setAdminMsg(`Restore failed: ${res?.error || 'Unknown error'}`);
                }
              } finally { setBusy(false); }
            }}
            className="bg-amber-600 text-white text-xs px-3 py-1 rounded"
            title="Restore database from a backup file (requires restart)"
          >
            {busy ? 'Workingâ€¦' : 'Restore Database'}
          </button>
        </div>
        {adminMsg && <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2">{adminMsg}</div>}
        {adminMsg.includes('restart') && (
          <div className="flex justify-end mt-2">
            <button
              onClick={async ()=>{ try { await (window as any).api?.util?.restartApp?.(); } catch {} }}
              className="bg-black text-white text-xs px-3 py-1 rounded"
            >
              Restart Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

