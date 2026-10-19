/**
 * Confirmation boxes that belong to the app.
 *
 * window.confirm() opens a grey Windows box headed with the app's internal
 * address, in the system font, with OK and Cancel in whatever order Windows
 * likes. It also freezes the whole page until answered. This one matches the
 * rest of the app, says what will happen in plain words, and puts the safe
 * choice under the cursor when the action cannot be undone.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Delete Panadol?', tone: 'danger' }))) return;
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface Ask {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for anything that cannot be undone. */
  tone?: 'danger' | 'default';
}

type ConfirmFn = (ask: Ask) => Promise<boolean>;

const Ctx = createContext<ConfirmFn>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolver = useRef<(v: boolean) => void>();
  const safeBtn = useRef<HTMLButtonElement>(null);
  const goBtn = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((a) => new Promise((res) => {
    resolver.current = res;
    setAsk(a);
  }), []);

  const answer = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = undefined;
    setAsk(null);
  };

  useEffect(() => {
    if (!ask) return;
    // Destructive: the cursor starts on Cancel, so a reflexive Enter is safe.
    (ask.tone === 'danger' ? safeBtn : goBtn).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ask]);

  const danger = ask?.tone === 'danger';

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {ask && (
        <div
          className="fixed inset-0 z-[10001] grid place-items-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) answer(false); }}
          role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
        >
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-raised border
                          bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700">
            <div className="flex gap-4">
              <span className={`shrink-0 w-11 h-11 rounded-full grid place-items-center ${
                danger ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300'
                       : 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {danger
                    ? <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>
                    : <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>}
                </svg>
              </span>
              <div className="min-w-0 pt-0.5">
                <h2 id="confirm-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">{ask.title}</h2>
                {ask.message && <div className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{ask.message}</div>}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2.5">
              <button ref={safeBtn} onClick={() => answer(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium border transition
                  border-slate-300 text-slate-700 hover:bg-slate-50
                  dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                {ask.cancelLabel || 'Cancel'}
              </button>
              <button ref={goBtn} onClick={() => answer(true)}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition ${
                  danger ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-700 hover:bg-teal-800'}`}>
                {ask.confirmLabel || (danger ? 'Delete' : 'OK')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm() {
  return useContext(Ctx);
}
