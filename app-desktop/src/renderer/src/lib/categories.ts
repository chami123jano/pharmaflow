import { useCallback, useEffect, useState } from 'react';

/**
 * Product categories, in two groups.
 *
 * A pharmacy counter sells more than medicine — milk powder, baby food,
 * soothers, Milo, cosmetics. With only medical groups to choose from those
 * ended up under "Supplement" or "Other", and the filter could not find them.
 * The two lists are kept apart so the dropdown reads as two short sections
 * rather than one wall of thirty-odd names.
 *
 * The built-in names are fixed so every shop's data spells them the same way.
 * On top of those an admin can add the shop's own. Those are shared: adding
 * or removing one here reaches the other PC and the website through sync, and
 * one added on the website arrives here the same way. A product carries its
 * category as text, so an item keeps its category even if that name is later
 * removed from the list.
 *
 * The built-in lists are repeated in web/src/lib/categories.ts — keep the two
 * in step.
 */
export const MEDICINE_CATS = ['Analgesic','Anthelmintic','Antibiotic','Antidiabetic','Antifungal','Antihistamine','Antihypertensive','Antiparasitic','Antiviral','Ayurvedic','Cardiac','CNS','Diuretic','First Aid','GI','Gynaecology','NSAID','Ophthalmic','Respiratory','Rheumatology','Statin','Steroid','Supplement','Thyroid','Topical','Urological'];
export const SHOP_CATS = ['Milk Powder','Baby Food','Baby Care','Beverages','Biscuits & Snacks','Cosmetics','Personal Care'];

export type CatGroup = 'Medicines' | 'Shop items';
export interface CustomCat { name: string; group: CatGroup }

const RESERVED = ['all', 'other'];

function parse(v: any): CustomCat[] {
  try {
    const arr = JSON.parse(v || '[]');
    return Array.isArray(arr)
      ? arr.filter((c) => c && typeof c.name === 'string' && c.name.trim())
           .map((c) => ({ name: c.name.trim(), group: c.group === 'Shop items' ? 'Shop items' : 'Medicines' }))
      : [];
  } catch { return []; }
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

export function useCategories(userId?: string) {
  const [custom, setCustom] = useState<CustomCat[]>([]);

  const load = useCallback(async () => {
    const r: any = await (window as any).api?.categories?.list?.();
    setCustom(r?.ok ? parse(JSON.stringify(r.data)) : []);
  }, []);

  useEffect(() => {
    load();
    const h = (e: any) => { if (e?.detail?.area === 'categories') load(); };
    window.addEventListener('ph:data:changed', h);
    return () => window.removeEventListener('ph:data:changed', h);
  }, [load]);

  const medicine = [...MEDICINE_CATS, ...custom.filter((c) => c.group === 'Medicines').map((c) => c.name)].sort(byName);
  const shop = [...SHOP_CATS, ...custom.filter((c) => c.group === 'Shop items').map((c) => c.name)].sort(byName);

  function changed(list: any) {
    setCustom(parse(JSON.stringify(list || [])));
    window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'categories' } }));
  }

  /** Returns an error message, or null when the category was added. */
  async function add(rawName: string, group: CatGroup): Promise<string | null> {
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return 'Type a name for the category';
    if (name.length > 30) return 'Keep the name under 30 letters';
    const lower = name.toLowerCase();
    if (RESERVED.includes(lower)) return `"${name}" is already used by the app`;
    const clash = [...medicine, ...shop].find((c) => c.toLowerCase() === lower);
    if (clash) return `"${clash}" is already a category`;
    const nice = name.charAt(0).toUpperCase() + name.slice(1);
    const r: any = await (window as any).api?.categories?.add?.(nice, group, userId);
    if (!r?.ok) return r?.message || 'Could not add the category';
    changed(r.data);
    return null;
  }

  async function remove(name: string) {
    const r: any = await (window as any).api?.categories?.remove?.(name, userId);
    if (r?.ok) changed(r.data);
  }

  return { medicine, shop, custom, add, remove, isCustom: (n: string) => custom.some((c) => c.name === n) };
}
