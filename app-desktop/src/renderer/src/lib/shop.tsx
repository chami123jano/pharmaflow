import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * The shop's own identity, read from settings.
 *
 * Nothing in the interface hardcodes a shop name. The default below is the
 * product's name, so a fresh copy of this software runs as PharmaFlow; the
 * moment a real shop fills in Settings, every screen and every receipt follows
 * without a line of code changing. That is what lets one codebase serve both
 * a named pharmacy and a public release.
 */
export interface Shop {
  name: string;
  address: string;
  phone: string;
  regno: string;
  footer: string;
}

export const DEFAULT_SHOP: Shop = {
  name: 'PharmaFlow',
  address: '',
  phone: '',
  regno: '',
  footer: 'Thank you. Get well soon.',
};

interface ShopState extends Shop {
  reload: () => Promise<void>;
}

const Ctx = createContext<ShopState>({ ...DEFAULT_SHOP, reload: async () => {} });

export function ShopProvider({ children }: { children: ReactNode }) {
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);

  const reload = useCallback(async () => {
    const r: any = await window.api?.settings?.list?.();
    if (!r?.ok) return;
    const m: Record<string, string> = Object.fromEntries((r.data || []).map((s: any) => [s.key, s.value]));
    // A blank setting falls back rather than showing an empty header.
    const pick = (key: string, fallback: string) => (m[key]?.trim() ? m[key].trim() : fallback);
    setShop({
      name: pick('pharmacy.name', DEFAULT_SHOP.name),
      address: m['pharmacy.address']?.trim() || '',
      phone: m['pharmacy.phone']?.trim() || '',
      regno: m['pharmacy.regno']?.trim() || '',
      footer: pick('pharmacy.footer', DEFAULT_SHOP.footer),
    });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Settings can change while the app is open; the header should not wait for
  // a restart to catch up.
  useEffect(() => {
    const onChange = (e: any) => { if (e?.detail?.area === 'settings') reload(); };
    window.addEventListener('ph:data:changed', onChange);
    return () => window.removeEventListener('ph:data:changed', onChange);
  }, [reload]);

  useEffect(() => { document.title = shop.name; }, [shop.name]);

  return <Ctx.Provider value={{ ...shop, reload }}>{children}</Ctx.Provider>;
}

export function useShop() { return useContext(Ctx); }
