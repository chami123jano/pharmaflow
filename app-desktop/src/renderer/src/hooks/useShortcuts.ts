import { useEffect, useCallback } from 'react';

export interface ShortcutDef {
  key: string;          // e.g. 'D', 'F1', 'Enter', 'Escape'
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description: string;
  group?: string;
  action: () => void;
  enabled?: boolean;    // defaults to true
}

/**
 * Centralised keyboard shortcut engine.
 * Attaches a single keydown listener to window and dispatches to handlers.
 *
 * Usage:
 *   useShortcuts([
 *     { key:'D', ctrl:true, description:'Dashboard', group:'Navigation', action:()=>setPage('dashboard') }
 *   ]);
 */
export function useShortcuts(shortcuts: ShortcutDef[]) {
  const handler = useCallback((e: KeyboardEvent) => {
    // Don't fire when typing inside an input/textarea/select (unless it's a safe key)
    const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const key = e.key.toUpperCase();
    // Function keys and Escape must fire while the cashier is typing — the POS
    // keeps focus in the search box for the whole sale, so anything that only
    // worked outside an input would effectively never work at all.
    const isFunctionKey = /^F([1-9]|1[0-2])$/.test(key);
    const safeKeys = ['ESCAPE'];

    for (const sc of shortcuts) {
      if (sc.enabled === false) continue;

      const kMatch  = sc.key.toUpperCase() === key;
      const ctrlM   = !!sc.ctrl  === (e.ctrlKey  || e.metaKey);
      const shiftM  = !!sc.shift === e.shiftKey;
      const altM    = !!sc.alt   === e.altKey;

      if (!kMatch || !ctrlM || !shiftM || !altM) continue;

      // Allow Ctrl/Alt combos, function keys and Escape even in inputs;
      // block bare letter keys so typing a product name never triggers an action.
      if (isInput && !sc.ctrl && !sc.alt && !isFunctionKey && !safeKeys.includes(key)) continue;

      e.preventDefault();
      sc.action();
      return;
    }
  }, [shortcuts]);

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}

/** All global shortcut definitions (for the help overlay) */
export const GLOBAL_SHORTCUTS: Omit<ShortcutDef, 'action'>[] = [
  // Navigation
  { key:'D', ctrl:true, description:'Go to Dashboard',    group:'Navigation' },
  { key:'I', ctrl:true, description:'Go to Inventory',    group:'Navigation' },
  { key:'S', ctrl:true, description:'Go to Sales / POS',  group:'Navigation' },
  { key:'R', ctrl:true, description:'Go to Reports',      group:'Navigation' },
  { key:'U', ctrl:true, description:'Go to Users',        group:'Navigation' },
  { key:',', ctrl:true, description:'Go to Settings',     group:'Navigation' },
  // Global actions
  { key:'F1',     description:'Show keyboard shortcuts help',  group:'Global' },
  { key:'F5',     description:'Refresh current page',          group:'Global' },
  { key:'Escape', description:'Close modal / cancel',          group:'Global' },
  { key:'F', ctrl:true, description:'Focus search',            group:'Global' },
  { key:'N', ctrl:true, description:'New item / new sale',     group:'Global' },
  { key:'P', ctrl:true, description:'Print',                   group:'Global' },
  // POS — function keys so the hand never leaves the number pad
  { key:'F2',  description:'Jump back to the search box',        group:'POS' },
  { key:'F3',  description:'Hold current bill',                  group:'POS' },
  { key:'F4',  description:'Set discount',                       group:'POS' },
  { key:'F6',  description:'Recall a held bill',                 group:'POS' },
  { key:'F7',  description:'Exact cash (fills the total)',       group:'POS' },
  { key:'F8',  description:'Switch Cash / Card',                 group:'POS' },
  { key:'F9',  description:'Reprint last receipt',               group:'POS' },
  { key:'F12', description:'Pay / complete the sale',            group:'POS' },
  { key:'Delete', ctrl:true, description:'Clear the whole bill', group:'POS' },
  // Entry box
  { key:'Enter',     description:'Add highlighted item to the bill', group:'Entry' },
  { key:'6*name',    description:'Add six at once (also name*6)',    group:'Entry' },
  { key:'ArrowUp',   description:'Move up (results, or bill when empty)',   group:'Entry' },
  { key:'ArrowDown', description:'Move down (results, or bill when empty)', group:'Entry' },
  { key:'+',         description:'Increase qty of the selected line', group:'Entry' },
  { key:'-',         description:'Decrease qty of the selected line', group:'Entry' },
  { key:'Delete',    description:'Remove the selected line',          group:'Entry' },
];
