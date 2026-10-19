/**
 * A dropdown that belongs to the app.
 *
 * The browser's own <select> opens a list drawn by Windows: system font, a
 * hard blue highlight, no search, and a thirty-three-item scroll to find "Milk
 * Powder". It was the most dated thing left on screen. This one matches
 * everything else, and adds the thing a long list actually needs — typing to
 * filter.
 *
 * Keyboard first, because the till is: Enter, Space or Down opens it; Up and
 * Down move; Enter picks; Escape closes; any letter starts filtering.
 *
 * The list is drawn into <body> with fixed positioning, so a modal with
 * overflow hidden cannot clip it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface Option {
  value: string;
  label: string;
  group?: string;
  /** Shown faintly beside the label. */
  hint?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  /** Defaults to on when there are more than eight options. */
  searchable?: boolean;
  className?: string;
  /** Matches the input token's height: 'md' for forms, 'sm' for toolbars. */
  size?: 'sm' | 'md';
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

export default function Select({
  value, onChange, options, placeholder = 'Choose…', searchable, className = '',
  size = 'md', disabled, id, ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const canSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.group || '').toLowerCase().includes(q)) : options;
  }, [options, query]);

  /** Place the list under the trigger, or above it when the screen ends first. */
  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 240 && above > below;
    setPos({
      left: r.left, width: Math.max(r.width, 200),
      top: up ? r.top - 6 : r.bottom + 6,
      maxH: Math.min(320, up ? above : below), up,
    });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) close(false);
    };
    const onMove = () => place();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  // Opening lands on the current choice, so Down moves on from there.
  useEffect(() => {
    if (!open) return;
    const i = shown.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    if (canSearch) setTimeout(() => search.current?.focus(), 0);
  }, [open]);

  useEffect(() => { if (query) setActive(0); }, [query]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function close(refocus = true) {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  }

  function pick(o: Option) {
    onChange(o.value);
    close();
  }

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      else if (canSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey) { setOpen(true); setQuery(e.key); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); }
  }

  const pad = size === 'sm' ? 'px-3 py-2 text-sm' : 'px-3.5 py-2.5 text-sm';

  // Group headings drawn where the group changes, so a filtered list keeps them.
  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={rest['aria-label']}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onKey}
        className={`w-full flex items-center justify-between gap-2 rounded-xl border text-left transition ${pad}
          bg-white border-slate-300 text-slate-900 hover:border-slate-400
          dark:bg-slate-700/60 dark:border-slate-600 dark:text-slate-100 dark:hover:border-slate-500
          focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-600
          disabled:opacity-50 disabled:cursor-not-allowed
          ${open ? 'ring-2 ring-teal-600/25 border-teal-600' : ''} ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-slate-400'}`}>{selected?.label ?? placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
             className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={list}
          role="listbox"
          onKeyDown={onKey}
          style={{
            position: 'fixed', left: pos.left, width: pos.width, maxHeight: pos.maxH,
            ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
          }}
          className="z-[9999] flex flex-col rounded-xl border shadow-raised overflow-hidden
            bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700"
        >
          {canSearch && (
            <div className="p-2 border-b border-slate-100 dark:border-slate-700 shrink-0">
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to filter…"
                className="w-full px-3 py-2 text-sm rounded-lg outline-none
                  bg-slate-50 text-slate-900 placeholder-slate-400
                  dark:bg-slate-900/60 dark:text-slate-100"
              />
            </div>
          )}
          <div className="overflow-y-auto py-1">
            {shown.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-400">Nothing matches "{query}"</p>
            )}
            {shown.map((o, i) => {
              const heading = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const isSel = o.value === value;
              return (
                <div key={o.value + i}>
                  {heading && (
                    <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                      {heading}
                    </div>
                  )}
                  <div
                    data-i={i}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                    className={`mx-1 px-2.5 py-2 rounded-lg flex items-center gap-2 text-sm cursor-pointer ${
                      i === active
                        ? 'bg-teal-50 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100'
                        : 'text-slate-700 dark:text-slate-200'}`}
                  >
                    <span className="w-4 shrink-0 text-teal-700 dark:text-teal-300">
                      {isSel && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                      )}
                    </span>
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="ml-auto text-xs text-slate-400">{o.hint}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
