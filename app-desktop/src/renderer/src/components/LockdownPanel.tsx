import { useState, useEffect, useCallback } from 'react';
import { useToast } from './Toast';
import { ui } from '../lib/ui';

/**
 * Turns the staff lockdown on and off.
 *
 * Both switches are off out of the box. Turning them on is deliberate, and
 * turning them on asks for the admin password first — otherwise anyone at the
 * counter could lock the owner out of their own till.
 */
export default function LockdownPanel({ user, darkMode }: { user?: any; darkMode?: boolean }) {
  const toast = useToast();
  const t = ui(darkMode);
  const [lockExit, setLockExit] = useState(false);
  const [kiosk, setKiosk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<null | { key: 'security.lock_exit' | 'security.kiosk'; next: boolean }>(null);
  const [password, setPassword] = useState('');

  const load = useCallback(async () => {
    const r: any = await window.api?.settings?.list?.();
    if (!r?.ok) return;
    const m: any = Object.fromEntries((r.data || []).map((s: any) => [s.key, s.value]));
    const on = (v: any) => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase());
    setLockExit(on(m['security.lock_exit']));
    setKiosk(on(m['security.kiosk']));
  }, []);

  useEffect(() => { load(); }, [load]);

  function request(key: 'security.lock_exit' | 'security.kiosk', next: boolean) {
    setPassword('');
    setAsk({ key, next });
  }

  async function apply() {
    if (!ask) return;
    setBusy(true);
    const check: any = await window.api?.auth?.verifyAdmin?.(password);
    if (!check?.ok) {
      setBusy(false);
      toast.error(check?.message || 'Not an admin password');
      return;
    }
    await window.api?.settings?.set?.(ask.key, ask.next ? '1' : '0');
    if (ask.key === 'security.kiosk') {
      await window.api?.app?.setKiosk?.(ask.next);
    }
    setBusy(false);
    setAsk(null);
    setPassword('');
    toast.success(ask.next ? 'Turned on' : 'Turned off');
    load();
  }

  const Row = ({ on, onChange, title, body }: { on: boolean; onChange: (v: boolean) => void; title: string; body: string }) => (
    <div className={`${t.well} p-4 flex items-start justify-between gap-4`}>
      <div className="min-w-0">
        <div className={`font-semibold ${t.page}`}>{title}</div>
        <p className={`text-sm mt-0.5 ${t.muted}`}>{body}</p>
      </div>
      <button
        onClick={() => onChange(!on)}
        className={`shrink-0 w-14 h-8 rounded-full transition relative ${on ? 'bg-emerald-600' : t.dark ? 'bg-slate-600' : 'bg-slate-300'}`}
        aria-pressed={on}
      >
        <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${on ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );

  return (
    <div className={`${t.card} p-5`}>
      <h2 className={`text-lg font-bold ${t.page}`}>Staff lockdown</h2>
      <p className={`text-sm mb-4 ${t.muted}`}>
        Stops a cashier closing the till or wandering off into Windows. Turning either on needs
        the admin password.
      </p>

      <div className="space-y-3">
        <Row
          on={lockExit}
          onChange={(v) => request('security.lock_exit', v)}
          title="Admin password to close"
          body="The X button and Alt+F4 both ask for the password instead of quitting."
        />
        <Row
          on={kiosk}
          onChange={(v) => request('security.kiosk', v)}
          title="Fullscreen kiosk"
          body="Fills the screen and hides the menu bar, so the desktop and taskbar are out of reach."
        />
      </div>

      <p className={`text-xs mt-4 ${t.faint}`}>
        This covers the app. To stop staff using the rest of the computer you also need a limited
        Windows account on the shop PC — that part is set up in Windows, not here.
      </p>

      {ask && (
        <div className={t.overlay} onClick={(e) => { if (e.target === e.currentTarget) setAsk(null); }}>
          <div className={`${t.modal} max-w-sm p-6`}>
            <h3 className={`text-lg font-bold ${t.page}`}>
              {ask.next ? 'Turn on' : 'Turn off'} — admin password
            </h3>
            <p className={`text-sm mt-1 mb-4 ${t.muted}`}>
              {ask.key === 'security.kiosk' ? 'Fullscreen kiosk' : 'Admin password to close'}
            </p>
            <input
              autoFocus type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); apply(); }
                if (e.key === 'Escape') { e.preventDefault(); setAsk(null); }
              }}
              placeholder="Admin password" className={t.input}
            />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAsk(null)} className={`flex-1 ${t.btnGhost}`}>Cancel</button>
              <button onClick={apply} disabled={busy} className={`flex-1 ${t.btnPrimary}`}>
                {busy ? 'Checking…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
