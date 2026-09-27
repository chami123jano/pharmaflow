import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Mark = 'capsule' | 'cross';

export interface Shop {
  name: string;
  address: string;
  phone: string;
  mark: Mark;
}

/**
 * Build-time fallbacks.
 *
 * These are what the site shows in the half-second before the shop's real
 * details arrive, and what it keeps showing if the mirror has never been
 * written. The defaults belong to nobody, so an untouched copy of this repo
 * runs as PharmaFlow with the neutral mark.
 */
export const SHOP_NAME = (import.meta.env.VITE_SHOP_NAME || 'PharmaFlow').trim();
export const SHOP_MARK: Mark =
  (import.meta.env.VITE_LOGO || '').trim() === 'capsule' ? 'capsule' : 'cross';

const FALLBACK: Shop = { name: SHOP_NAME, address: '', phone: '', mark: SHOP_MARK };

let cached: Shop | null = null;

/**
 * The shop's identity, read from the mirror the till writes.
 *
 * It used to come from Cloudflare build variables, which meant renaming the
 * shop or changing its logo needed someone to remember a setting in a
 * dashboard and trigger a rebuild — and until they did, the site and the till
 * disagreed. Reading it from the database means the till is the only place any
 * of it is ever typed.
 *
 * The row is readable without signing in, because the login screen has to show
 * the shop's name before there is a session. It holds nothing that is not
 * already on the shop's signboard.
 */
export function useShop(): Shop {
  const [shop, setShop] = useState<Shop>(cached ?? FALLBACK);

  useEffect(() => {
    let alive = true;
    supabase
      .from('shop')
      .select('name,address,phone,logo')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        // A missing table or row is not a failure worth showing anyone — the
        // fallbacks are already on screen and perfectly serviceable.
        if (!alive || error || !data) return;
        const next: Shop = {
          name: (data.name || '').trim() || FALLBACK.name,
          address: (data.address || '').trim(),
          phone: (data.phone || '').trim(),
          mark: (data.logo || '').trim() === 'capsule' ? 'capsule' : 'cross',
        };
        cached = next;
        setShop(next);
      });
    return () => { alive = false; };
  }, []);

  // The tab icon and the iOS home-screen icon are files, not components, so
  // they are swapped by pointing the existing links at the matching variant.
  useEffect(() => {
    const set = (selector: string, href: string) => {
      const el = document.querySelector<HTMLLinkElement>(selector);
      if (el && !el.href.endsWith(href)) el.href = href;
    };
    set('link[rel="icon"][type="image/svg+xml"]', `/favicon-${shop.mark}.svg`);
    set('link[rel="icon"][type="image/png"]', `/favicon-${shop.mark}.png`);
    set('link[rel="apple-touch-icon"]', `/apple-touch-icon-${shop.mark}.png`);
  }, [shop.mark]);

  return shop;
}
