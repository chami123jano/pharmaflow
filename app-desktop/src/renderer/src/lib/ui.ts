/**
 * Shared visual language.
 *
 * Every screen was styling itself with its own ad-hoc Tailwind strings, so
 * cards, inputs and buttons drifted apart and dark mode was patchy. These are
 * the only definitions — screens compose them rather than inventing their own.
 */

export function ui(dark?: boolean) {
  const d = !!dark;
  return {
    dark: d,

    /** Page furniture */
    page: d ? 'text-slate-100' : 'text-slate-900',
    muted: d ? 'text-slate-400' : 'text-slate-500',
    faint: d ? 'text-slate-500' : 'text-slate-400',
    border: d ? 'border-slate-700' : 'border-slate-200',

    /** A raised surface. Soft border plus a light shadow, never both heavy. */
    card: d
      ? 'rounded-2xl border border-slate-700/80 bg-slate-800 shadow-sm'
      : 'rounded-2xl border border-slate-200/80 bg-white shadow-sm',

    /** A recessed area inside a card. */
    well: d ? 'rounded-xl bg-slate-700/40 border border-slate-700' : 'rounded-xl bg-slate-50 border border-slate-200',

    input: d
      ? 'w-full px-3.5 py-2.5 rounded-xl border border-slate-600 bg-slate-700/60 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500 transition'
      : 'w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition',

    label: d
      ? 'block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5'
      : 'block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5',

    btnPrimary: 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm',
    btnSuccess: 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40 transition shadow-sm',
    btnDanger: 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 transition shadow-sm',
    btnGhost: d
      ? 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-medium hover:bg-slate-700 transition'
      : 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition',

    /** Table parts, so every list reads the same way. */
    th: d
      ? 'text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-700/50'
      : 'text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50',
    td: d ? 'px-4 py-2.5 border-t border-slate-700' : 'px-4 py-2.5 border-t border-slate-100',
    rowHover: d ? 'hover:bg-slate-700/40 transition-colors' : 'hover:bg-slate-50 transition-colors',
    rowActive: d ? 'bg-blue-900/40' : 'bg-blue-50',

    overlay: 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4',
    modal: d
      ? 'rounded-2xl bg-slate-800 border border-slate-700 shadow-2xl w-full'
      : 'rounded-2xl bg-white border border-slate-200 shadow-2xl w-full',
  };
}

export type Ui = ReturnType<typeof ui>;

/** Small status pill. Colours are shared so "low" looks the same everywhere. */
export function pill(tone: 'ok' | 'low' | 'out' | 'warn' | 'info' | 'muted'): string {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold';
  switch (tone) {
    case 'ok':   return base + ' bg-emerald-100 text-emerald-700';
    case 'low':  return base + ' bg-amber-100 text-amber-700';
    case 'out':  return base + ' bg-red-100 text-red-700';
    case 'warn': return base + ' bg-orange-100 text-orange-700';
    case 'info': return base + ' bg-blue-100 text-blue-700';
    default:     return base + ' bg-slate-100 text-slate-600';
  }
}
