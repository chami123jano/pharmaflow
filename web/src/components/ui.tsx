import type { ReactNode } from 'react';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
      {label && <p className="muted text-sm">{label}</p>}
    </div>
  );
}

export function Empty({ title, body, icon }: { title: string; body?: string; icon?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-3xl opacity-60">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {body && <p className="muted max-w-xs text-sm">{body}</p>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="card border-red-300 p-4 dark:border-red-900/60">
      <p className="text-sm font-semibold text-red-600 dark:text-red-400">Could not load that</p>
      <p className="muted mt-1 break-words text-sm">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost mt-3">Try again</button>
      )}
    </div>
  );
}

const TONES: Record<string, string> = {
  bad: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  none: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
};

export function Pill({ tone = 'none', children }: { tone?: keyof typeof TONES | string; children: ReactNode }) {
  return <span className={`pill ${TONES[tone] || TONES.none}`}>{children}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="faint text-[11px] font-bold uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone || ''}`}>{value}</p>
      {sub && <p className="muted mt-0.5 text-xs">{sub}</p>}
    </div>
  );
}

/** A bottom sheet on a phone, a centred dialog on anything wider. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card safe-bottom max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 sm:rounded-b-2xl"
        style={{ borderBottomWidth: 0 }}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="faint px-2 text-2xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
