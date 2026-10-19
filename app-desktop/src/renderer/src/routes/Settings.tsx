import { useEffect, useState, type ReactNode } from 'react';
import SyncPanel from '../components/SyncPanel';
import LockdownPanel from '../components/LockdownPanel';
import ShopPanel from '../components/ShopPanel';
import Select from '../components/Select';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { ui } from '../lib/ui';

interface Setting { key:string; value:string }

/**
 * Five panels stacked on one page made Settings the only screen that scrolled,
 * and put the printer and backups so far down they were easy to miss. Each is
 * now a tab; nothing about what they do has changed.
 */
const TABS = [
  { key: 'shop',     label: 'Shop details' },
  { key: 'printer',  label: 'Printer' },
  { key: 'lockdown', label: 'Staff lockdown' },
  { key: 'sync',     label: 'Cloud sync' },
  { key: 'tools',    label: 'Backup & tools' },
] as const;
type Tab = typeof TABS[number]['key'];

function savedTab(): Tab {
  try {
    const v = localStorage.getItem('settingsTab');
    if (TABS.some((t) => t.key === v)) return v as Tab;
  } catch {}
  return 'shop';
}

export default function Settings({ user, darkMode }: { user?: any; tokens?: any; darkMode?: boolean }){
  const toast = useToast();
  const ask = useConfirm();
  const t = ui(darkMode);
  const [tab, setTabState] = useState<Tab>(savedTab);
  const [items,setItems] = useState<Setting[]>([]);
  const [form,setForm] = useState<Setting>({ key:'', value:''});
  const [printers, setPrinters] = useState<Array<{ name:string; displayName?:string; isDefault?:boolean }>>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [silent, setSilent] = useState<boolean>(false);
  const [adminMsg, setAdminMsg] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [advanced, setAdvanced] = useState(false);

  function setTab(k: Tab) {
    setTabState(k);
    try { localStorage.setItem('settingsTab', k); } catch {}
  }

  function load(){
    window.api.settings.list().then(r=>{
      if(r?.ok && Array.isArray(r.data)) setItems(r.data as Setting[]);
      else if(r?.ok) setItems([]);
    });
  }
  useEffect(()=>{ load(); },[]);
  useEffect(()=>{
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
    const name = items.find(i=>i.key==='printer.receipt.name')?.value || '';
    const silentVal = (items.find(i=>i.key==='printer.receipt.silent')?.value || '').toLowerCase();
    setSelectedPrinter(name);
    setSilent(silentVal==='1' || silentVal==='true' || silentVal==='yes');
  },[items]);

  function save(){
    if(!form.key) return;
    window.api.settings.set(form.key, form.value).then(r=>{
      if(r?.ok){ setForm({key:'',value:''}); load(); toast.success('Saved'); }
    });
  }

  async function savePrinterSettings(){
    await window.api.settings.set('printer.receipt.name', selectedPrinter || '');
    await window.api.settings.set('printer.receipt.silent', silent ? '1' : '0');
    load();
    toast.success('Printer settings saved');
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
      if (r?.ok) toast.success('Test page sent to the printer');
      else if (r?.error === 'CANCELLED') toast.info('Printing was cancelled');
      else toast.error('Print failed: ' + (r?.message || 'unknown reason'));
    } catch (e: any) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? (e as any).message : String(e);
      toast.error('Print error: ' + msg);
    }
  }

  async function resetAllSales() {
    // This used to run on a single click with no question asked.
    if (!(await ask({
      title: 'Delete every sale?',
      message: 'All bills are removed and the stock they sold is put back. Reports start again from nothing. This cannot be undone — take a backup first.',
      confirmLabel: 'Delete all sales',
      tone: 'danger',
    }))) return;
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
  }

  async function seedMedicines() {
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
  }

  async function backup() {
    try {
      setBusy(true); setAdminMsg('');
      const res = await (window as any).api?.admin?.backupDb?.();
      if(res?.ok){
        setAdminMsg(`Backup saved to: ${res?.data?.filePath || 'selected location'}`);
      } else if(res?.error !== 'CANCELED') {
        setAdminMsg(`Backup failed: ${res?.error || 'Unknown error'}`);
      }
    } finally { setBusy(false); }
  }

  async function restore() {
    if (!(await ask({
      title: 'Restore from a backup?',
      message: 'Everything on this computer is replaced by the backup you choose, when the app restarts. Sales made since that backup are lost.',
      confirmLabel: 'Choose backup file',
      tone: 'danger',
    }))) return;
    try {
      setBusy(true); setAdminMsg('');
      const res = await (window as any).api?.admin?.restoreDb?.();
      if(res?.ok){
        setAdminMsg('Restore file staged. The app needs to restart to apply the backup.');
      } else if(res?.error !== 'CANCELED') {
        setAdminMsg(`Restore failed: ${res?.error || 'Unknown error'}`);
      }
    } finally { setBusy(false); }
  }

  const Tool = ({ title, body, children, tone }: { title: string; body: string; children: ReactNode; tone?: 'danger' }) => (
    <div className={`${tone === 'danger'
        ? (t.dark ? 'rounded-xl border border-red-900/60 bg-red-950/30' : 'rounded-xl border border-red-200 bg-red-50/60')
        : t.well} p-4 flex items-center justify-between gap-4`}>
      <div className="min-w-0">
        <div className={`font-semibold ${tone === 'danger' ? (t.dark ? 'text-red-300' : 'text-red-700') : t.page}`}>{title}</div>
        <p className={`text-sm mt-0.5 ${t.muted}`}>{body}</p>
      </div>
      <div className="shrink-0 flex gap-2">{children}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5 lg:h-[calc(100vh-2.5rem)]">
      <div className="shrink-0">
        <h1 className={`text-2xl font-bold tracking-tight ${t.page}`}>Settings</h1>
        <p className={`text-sm ${t.muted}`}>How the till looks, prints, syncs and is kept safe.</p>
      </div>

      <div role="tablist" aria-label="Settings sections"
        className={`shrink-0 self-start flex gap-1 p-1.5 ${t.card}`}>
        {TABS.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition whitespace-nowrap ${
              tab === x.key
                ? 'bg-teal-700 text-white shadow-sm'
                : `${t.muted} ${t.dark ? 'hover:text-slate-100 hover:bg-slate-700/50' : 'hover:text-slate-900 hover:bg-slate-100'}`}`}>
            {x.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-1">
        {tab === 'shop' && <ShopPanel darkMode={darkMode} />}
        {tab === 'lockdown' && <LockdownPanel user={user} darkMode={darkMode} />}
        {tab === 'sync' && <SyncPanel darkMode={darkMode} />}

        {tab === 'printer' && (
          <div className={`${t.card} p-5 max-w-2xl`}>
            <h2 className={`text-lg font-bold ${t.page}`}>Receipt printer</h2>
            <p className={`text-sm mt-0.5 mb-5 ${t.muted}`}>Where bills go when you press Print.</p>

            <label className={t.label}>Printer</label>
            <Select aria-label="Receipt printer" value={selectedPrinter} onChange={setSelectedPrinter} options={[
              { value: '', label: 'System default' },
              ...printers.map((p: any) => ({ value: p.name, label: p.displayName || p.name, hint: p.isDefault ? 'Default' : undefined })),
            ]} />

            <div className={`${t.well} p-4 mt-4 flex items-start justify-between gap-4`}>
              <div className="min-w-0">
                <div className={`font-semibold ${t.page}`}>Print without asking</div>
                <p className={`text-sm mt-0.5 ${t.muted}`}>Sends the bill straight to the printer, skipping the Windows print box.</p>
              </div>
              <button
                role="switch" aria-checked={silent} aria-label="Print without asking"
                onClick={() => setSilent(!silent)}
                className={`shrink-0 w-14 h-8 rounded-full transition relative ${silent ? 'bg-lime-700' : t.dark ? 'bg-slate-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${silent ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            <div className="mt-5 flex gap-2.5">
              <button onClick={savePrinterSettings} className={t.btnPrimary}>Save printer settings</button>
              <button onClick={testPrint} className={t.btnGhost}>Print a test page</button>
            </div>
          </div>
        )}

        {tab === 'tools' && (
          <div className={`${t.card} p-5 max-w-3xl space-y-3`}>
            <div className="mb-2">
              <h2 className={`text-lg font-bold ${t.page}`}>Backup & tools</h2>
              <p className={`text-sm mt-0.5 ${t.muted}`}>Keep a copy of everything, and a few one-off jobs.</p>
            </div>

            <Tool title="Back up" body="Saves a copy of all products, stock and sales to a file you choose. Do this often — a USB stick is fine.">
              <button disabled={busy} onClick={backup} className={t.btnPrimary}>{busy ? 'Working…' : 'Back up now'}</button>
            </Tool>

            <Tool title="Restore" body="Replaces everything here with a backup file. Takes effect when the app restarts.">
              <button disabled={busy} onClick={restore} className={t.btnGhost}>{busy ? 'Working…' : 'Restore…'}</button>
            </Tool>

            <Tool title="Add common medicines" body="Adds well-known Sri Lankan medicines with name, category and SKU. Ones already here are skipped.">
              <button onClick={seedMedicines} className={t.btnGhost}>Add medicines</button>
            </Tool>

            <Tool tone="danger" title="Delete all sales" body="Removes every bill and puts the sold stock back. Only for starting fresh after testing.">
              <button onClick={resetAllSales} className={t.btnDanger}>Delete all sales…</button>
            </Tool>

            {adminMsg && (
              <div className={`${t.well} p-3 text-sm flex items-center justify-between gap-3 ${t.page}`}>
                <span className="min-w-0 break-words">{adminMsg}</span>
                {adminMsg.includes('restart') && (
                  <button
                    onClick={async ()=>{ try { await (window as any).api?.util?.restartApp?.(); } catch {} }}
                    className={`${t.btnPrimary} shrink-0`}
                  >
                    Restart now
                  </button>
                )}
              </div>
            )}

            {/* The raw settings table is for troubleshooting, not daily use. */}
            <div className={`pt-2 border-t ${t.border}`}>
              <button onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}
                className={`mt-2 text-sm font-medium ${t.muted} ${t.dark ? 'hover:text-slate-200' : 'hover:text-slate-800'}`}>
                {advanced ? '▾' : '▸'} Advanced: every stored setting
              </button>
              {advanced && (
                <div className="mt-3 space-y-3">
                  <div className={`${t.well} overflow-hidden`}>
                    <table className="w-full text-sm">
                      <thead><tr><th className={t.th}>Key</th><th className={t.th}>Value</th></tr></thead>
                      <tbody>
                        {items.map(s=>(
                          <tr key={s.key}>
                            <td className={`${t.td} font-mono text-xs ${t.page}`}>{s.key}</td>
                            <td className={`${t.td} font-mono text-xs break-all ${t.muted}`}>{s.value}</td>
                          </tr>
                        ))}
                        {!items.length && <tr><td colSpan={2} className={`${t.td} text-center ${t.faint}`}>No settings</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2">
                    <input className={t.input} placeholder="Key" value={form.key} onChange={e=>setForm(f=>({...f,key:e.target.value}))} />
                    <input className={t.input} placeholder="Value" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} />
                    <button onClick={save} className={`${t.btnPrimary} shrink-0`}>Save</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
