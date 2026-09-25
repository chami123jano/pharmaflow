import { useState, useEffect, useRef } from 'react';
import { ui } from '../lib/ui';
import { useShop } from '../lib/shop';

/**
 * Stands between a cashier and the close button.
 *
 * The main process refuses the close and tells us; we ask for an admin
 * password and, only if it checks out, tell the main process to let it
 * through. Nothing here decides anything on its own — the password is
 * verified in the main process against the database.
 */
export default function ExitGuard({ darkMode }: { darkMode?: boolean }) {
  const shop = useShop();
  const t = ui(darkMode);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const off = window.api?.app?.onExitRequested?.(() => {
      setPassword('');
      setError('');
      setAsking(true);
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  useEffect(() => { if (asking) setTimeout(() => ref.current?.focus(), 60); }, [asking]);

  async function confirm() {
    if (!password) { setError('Enter the admin password'); return; }
    setChecking(true);
    const r: any = await window.api?.auth?.verifyAdmin?.(password);
    setChecking(false);
    if (r?.ok) {
      // The main process closes the window; nothing more to do here.
      await window.api?.app?.approveExit?.();
    } else {
      setError(r?.message || 'That is not an admin password');
      setPassword('');
      setTimeout(() => ref.current?.focus(), 40);
    }
  }

  if (!asking) return null;

  return (
    <div className={t.overlay} style={{ zIndex: 9999 }}>
      <div className={`${t.modal} max-w-sm p-6`}>
        <h3 className={`text-lg font-bold ${t.page}`}>Close {shop.name}?</h3>
        <p className={`text-sm mt-1 mb-4 ${t.muted}`}>
          The till is locked. An admin password is needed to close it.
        </p>
        <input
          ref={ref}
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirm(); }
            if (e.key === 'Escape') { e.preventDefault(); setAsking(false); }
          }}
          placeholder="Admin password"
          className={t.input}
        />
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={() => setAsking(false)} className={`flex-1 ${t.btnGhost}`}>
            Keep working (Esc)
          </button>
          <button onClick={confirm} disabled={checking} className={`flex-1 ${t.btnDanger}`}>
            {checking ? 'Checking…' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
