import { useState, useEffect, useCallback } from 'react';
import { useToast } from './Toast';

/**
 * Connects this machine to whichever transport carries its changes.
 *
 * Cloud is the one to pick when there is a website: the till pushes its sales
 * and stock to Supabase, and the phone reads them even with the shop PC off.
 * GitHub is the no-server alternative for two PCs that only need to agree with
 * each other. Only one runs at a time; both stay configured.
 */
type Provider = 'github' | 'supabase';

export default function SyncPanel({ darkMode }: { darkMode?: boolean }) {
  const toast = useToast();
  const [status, setStatus] = useState<any>(null);
  const [tab, setTab] = useState<Provider>('supabase');
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudKey, setCloudKey] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // The tab follows the saved provider on first load only — after that the
  // owner is free to look at the other one without it snapping back.
  const [touched, setTouched] = useState(false);

  const refresh = useCallback(async () => {
    const r: any = await window.api?.sync?.status?.();
    if (!r?.ok) return;
    setStatus(r.data);
    if (r.data.owner && r.data.repo) setRepo(`${r.data.owner}/${r.data.repo}`);
    if (r.data.cloudUrl) setCloudUrl(r.data.cloudUrl);
    if (r.data.deviceLabel && r.data.deviceLabel !== r.data.deviceId) setLabel(r.data.deviceLabel);
    setTouched((t) => { if (!t) setTab(r.data.provider === 'github' ? 'github' : 'supabase'); return true; });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /**
   * Looking is not choosing. Opening the other tab must not quietly stop the
   * transport that is currently running — connecting picks it, or the button
   * on the tab does, and both are deliberate.
   */
  function pickTab(p: Provider) { setTab(p); }

  async function useThisOne() {
    await window.api?.sync?.setProvider?.(tab);
    toast.success(tab === 'supabase' ? 'Syncing to the cloud from now on' : 'Syncing through GitHub from now on');
    refresh();
  }

  async function connectGithub() {
    if (!repo.trim()) { toast.error('Enter the repository'); return; }
    setBusy(true);
    const r: any = await window.api?.sync?.configure?.({ repo: repo.trim(), token: token.trim() || undefined, label: label.trim() || undefined });
    setBusy(false);
    if (r?.ok) {
      setToken('');
      toast.success(r.data?.private === false ? 'Connected — but this repository is public' : 'Connected');
      refresh();
    } else {
      toast.error(r?.error || 'Could not connect');
    }
  }

  async function connectCloud() {
    if (!cloudUrl.trim()) { toast.error('Enter the Supabase project URL'); return; }
    setBusy(true);
    const r: any = await window.api?.sync?.configureCloud?.({ url: cloudUrl.trim(), key: cloudKey.trim() || undefined, label: label.trim() || undefined });
    setBusy(false);
    if (r?.ok) {
      setCloudKey('');
      toast.success('Connected to the cloud');
      refresh();
    } else {
      toast.error(r?.error || 'Could not connect');
    }
  }

  async function runSync() {
    setSyncing(true);
    const r: any = await window.api?.sync?.run?.();
    setSyncing(false);
    if (r?.ok) {
      const { applied, pushed, sales } = r.data || {};
      const moved = applied || pushed || sales;
      toast.success(moved ? `Received ${applied}, sent ${pushed}${sales ? `, mirrored ${sales} sales` : ''}` : 'Already up to date');
      try { window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'products' } })); } catch {}
    } else {
      toast.error(r?.error || 'Sync failed');
    }
    refresh();
  }

  /** Offline route: hand the same events over as a file. */
  async function exportFile() {
    const r: any = await window.api?.sync?.exportEvents?.();
    if (!r?.ok) { toast.error('Could not prepare the file'); return; }
    if (!r.data.count) { toast.info('Nothing new to send'); return; }
    const saved = await window.api?.util?.exportCSV?.(r.data.filename, r.data.content);
    if (saved) {
      await window.api?.sync?.markExported?.(r.data.ids);
      toast.success(`Saved ${r.data.count} change(s) to the file`);
      refresh();
    }
  }

  function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const r: any = await window.api?.sync?.importEvents?.(String(reader.result || ''));
      if (r?.ok) {
        const d = r.data;
        toast.success(d.applied ? `Applied ${d.applied} change(s)` : 'Nothing new in that file');
        try { window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'products' } })); } catch {}
        refresh();
      } else {
        toast.error(r?.error || 'Could not read that file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function disconnect() {
    const what = tab === 'supabase' ? 'the cloud' : 'the GitHub repository';
    if (!confirm(`Disconnect this device from ${what}? Local data is not affected.`)) return;
    await window.api?.sync?.disconnect?.(tab === 'supabase' ? 'cloud' : 'github');
    setToken('');
    setCloudKey('');
    toast.info('Disconnected');
    refresh();
  }

  const dm = darkMode;
  const card = `rounded-2xl border p-5 ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`;
  const tp = dm ? 'text-gray-100' : 'text-gray-900';
  const ts = dm ? 'text-gray-400' : 'text-gray-500';
  const inp = `w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${dm ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900'}`;
  const lbl = `block text-xs font-semibold uppercase tracking-wide mb-1 ${ts}`;

  const thisTabConnected = tab === 'supabase' ? !!status?.cloudConfigured : !!(status?.owner && status?.repo && status?.hasToken);
  const active = status?.provider === tab;

  const Tab = ({ id, title, sub }: { id: Provider; title: string; sub: string }) => (
    <button
      onClick={() => pickTab(id)}
      className={`flex-1 text-left px-4 py-3 rounded-xl border transition ${
        tab === id
          ? 'border-blue-500 ring-2 ring-blue-500/30 ' + (dm ? 'bg-gray-700' : 'bg-blue-50')
          : dm ? 'border-gray-700 hover:border-gray-600' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className={`text-sm font-bold ${tp} flex items-center gap-2`}>
        {title}
        {status?.provider === id && status?.configured && (
          <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-bold uppercase">Active</span>
        )}
      </div>
      <div className={`text-xs mt-0.5 ${ts}`}>{sub}</div>
    </button>
  );

  return (
    <div className={card}>
      <div className="flex items-start justify-between mb-1">
        <h2 className={`text-lg font-bold ${tp}`}>Sync</h2>
        {status?.configured && (
          <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-bold">Connected</span>
        )}
      </div>
      <p className={`text-sm mb-4 ${ts}`}>
        This PC keeps its own full copy and keeps selling with no internet at all. Sync only decides
        where that copy is echoed to.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <Tab id="supabase" title="Cloud — for the website" sub="Sales and stock readable from your phone, even with this PC off." />
        <Tab id="github" title="GitHub — two PCs only" sub="Shop and home agree with each other. No website." />
      </div>

      <div>
        <label className={lbl}>This device is</label>
        <input className={inp} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Shop counter / Home" />
      </div>

      {tab === 'supabase' ? (
        <div className="grid grid-cols-1 gap-4 mt-4">
          <div>
            <label className={lbl}>Project URL</label>
            <input className={inp} value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} placeholder="https://abcdefghijkl.supabase.co" />
            <p className={`text-xs mt-1 ${ts}`}>Supabase dashboard → Settings → API → Project URL.</p>
          </div>
          <div>
            <label className={lbl}>
              service_role key {status?.hasCloudKey && <span className="normal-case font-normal text-green-600">— saved{status?.cloudKeyEncrypted ? ' and encrypted' : ''}</span>}
            </label>
            <input className={inp} type="password" value={cloudKey} onChange={(e) => setCloudKey(e.target.value)}
              placeholder={status?.hasCloudKey ? 'Leave blank to keep the saved key' : 'eyJhbGciOi…'} />
            <p className={`text-xs mt-1 ${ts}`}>
              The <strong>service_role</strong> key, not the anon one. It belongs on this PC only — never in
              the website and never in a message.
              {status && !status.cloudKeyEncrypted && status.hasCloudKey && (
                <span className="text-orange-500"> This device cannot encrypt it, so it is stored as plain text.</span>
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 mt-4">
          <div>
            <label className={lbl}>Repository</label>
            <input className={inp} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="your-github-name/pharmacy-sync" />
          </div>
          <div>
            <label className={lbl}>
              GitHub token {status?.hasToken && <span className="normal-case font-normal text-green-600">— saved{status?.tokenEncrypted ? ' and encrypted' : ''}</span>}
            </label>
            <input className={inp} type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder={status?.hasToken ? 'Leave blank to keep the saved token' : 'ghp_… or github_pat_…'} />
            <p className={`text-xs mt-1 ${ts}`}>
              Needs only <strong>Contents: read and write</strong> on that one repository.
              {status && !status.tokenEncrypted && status.hasToken && (
                <span className="text-orange-500"> This device cannot encrypt it, so it is stored as plain text.</span>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-4">
        <button onClick={tab === 'supabase' ? connectCloud : connectGithub} disabled={busy}
          className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Checking…' : thisTabConnected ? 'Update connection' : 'Connect'}
        </button>
        <button onClick={runSync} disabled={syncing || !status?.configured || !active}
          className="px-4 py-2.5 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-40">
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        {thisTabConnected && !active && (
          <button onClick={useThisOne}
            className="px-4 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-bold hover:bg-slate-800">
            Use this one
          </button>
        )}
        {thisTabConnected && (
          <button onClick={disconnect}
            className={`px-4 py-2.5 rounded-xl border text-sm font-medium ${dm ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
            Disconnect
          </button>
        )}
      </div>

      {thisTabConnected && !active && (
        <p className={`text-xs mt-3 ${ts}`}>
          Set up, but not the one running — sync is going through{' '}
          <strong>{status?.provider === 'supabase' ? 'the cloud' : 'GitHub'}</strong> right now.
        </p>
      )}

      {tab === 'supabase' && !status?.cloudConfigured && (
        <p className={`text-xs mt-3 ${ts}`}>
          First time? In Supabase open <strong>SQL Editor → New query</strong>, paste the contents of
          <span className="font-mono"> supabase/schema.sql</span> from this project and run it. Then connect here.
        </p>
      )}

      <div className={`mt-5 pt-4 border-t ${dm ? 'border-gray-700' : 'border-gray-100'}`}>
        <h3 className={`text-sm font-bold ${tp}`}>No internet at the shop?</h3>
        <p className={`text-xs mt-0.5 mb-3 ${ts}`}>
          Send the same changes as a file — on a USB stick, or through a messaging app. Importing the
          same file twice is safe; nothing is applied a second time.
        </p>
        <div className="flex flex-wrap gap-3">
          <button onClick={exportFile}
            className={`px-4 py-2 rounded-xl border text-sm font-medium ${dm ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
            Save changes to a file
          </button>
          <label className={`px-4 py-2 rounded-xl border text-sm font-medium cursor-pointer ${dm ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
            Load a file from the other device
            <input type="file" accept=".jsonl,.json,.txt" onChange={importFile} className="hidden" />
          </label>
        </div>
      </div>

      {status && (
        <div className={`mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-3 text-sm ${dm ? 'border-gray-700' : 'border-gray-100'}`}>
          <div>
            <div className={`text-xs ${ts}`}>Device id</div>
            <div className={`font-mono text-xs ${tp}`}>{status.deviceId}</div>
          </div>
          <div>
            <div className={`text-xs ${ts}`}>Waiting to send</div>
            <div className={`font-bold ${status.pending > 0 ? 'text-orange-500' : tp}`}>{status.pending}</div>
          </div>
          <div>
            <div className={`text-xs ${ts}`}>Last sync</div>
            <div className={tp}>{status.lastSync ? new Date(status.lastSync).toLocaleString('en-GB') : 'never'}</div>
          </div>
          <div>
            <div className={`text-xs ${ts}`}>Result</div>
            <div className={status.lastResult?.startsWith('failed') ? 'text-red-500' : tp}>{status.lastResult || '—'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
