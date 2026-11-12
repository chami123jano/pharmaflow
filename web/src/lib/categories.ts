import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase'; // this spelling so the preview can stand in for it

/**
 * Categories and item codes, the same way the till does them.
 *
 * The built-in lists are repeated from app-desktop/src/renderer/src/lib/
 * categories.ts — keep the two in step. The shop's own categories come from
 * the till, through the shop row; ones added here are sent to the till as a
 * `category.added` event and shown here at once.
 */
export const MEDICINE_CATS = ['Analgesic','Anthelmintic','Antibiotic','Antidiabetic','Antifungal','Antihistamine','Antihypertensive','Antiparasitic','Antiviral','Ayurvedic','Cardiac','CNS','Diuretic','First Aid','GI','Gynaecology','NSAID','Ophthalmic','Respiratory','Rheumatology','Statin','Steroid','Supplement','Thyroid','Topical','Urological'];
export const SHOP_CATS = ['Milk Powder','Baby Food','Baby Care','Beverages','Biscuits & Snacks','Cosmetics','Personal Care'];

export type Group = 'Medicines' | 'Shop items';
export interface Cat { name: string; group: Group }

/** Added in this session but not yet back from the till. */
let pending: Cat[] = [];
const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

export function useCategories() {
  const [custom, setCustom] = useState<Cat[]>([]);
  useEffect(() => {
    let alive = true;
    // Its own query, so a cloud table without the column yet only loses this.
    supabase.from('shop').select('categories').eq('id', 1).maybeSingle().then(({ data }: any) => {
      if (!alive) return;
      const list: Cat[] = Array.isArray(data?.categories) ? data.categories : [];
      setCustom(list.filter((c) => c && c.name).map((c) => ({ name: String(c.name), group: c.group === 'Shop items' ? 'Shop items' : 'Medicines' })));
    });
    return () => { alive = false; };
  }, []);

  const all = [...custom, ...pending.filter((p) => !custom.some((c) => c.name.toLowerCase() === p.name.toLowerCase()))];
  const medicine = [...MEDICINE_CATS, ...all.filter((c) => c.group === 'Medicines').map((c) => c.name)].sort(byName);
  const shop = [...SHOP_CATS, ...all.filter((c) => c.group === 'Shop items').map((c) => c.name)].sort(byName);

  /** Returns an error message, or null once it is added and queued for the till. */
  async function add(raw: string, group: Group): Promise<string | null> {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return 'Type a name for the category';
    if (name.length > 30) return 'Keep the name under 30 letters';
    if (['all', 'other'].includes(name.toLowerCase())) return `"${name}" is already used`;
    const clash = [...medicine, ...shop].find((c) => c.toLowerCase() === name.toLowerCase());
    if (clash) return `"${clash}" is already a category`;
    const nice = name.charAt(0).toUpperCase() + name.slice(1);
    const { error } = await supabase.from('sync_events').insert({
      id: crypto.randomUUID(), device_id: 'web', type: 'category.added',
      payload: { name: nice, group, ts: new Date().toISOString() }, ts: new Date().toISOString(),
    });
    if (error) return error.message;
    pending = [...pending, { name: nice, group }];
    setCustom((c) => [...c]);
    return null;
  }

  return { medicine, shop, add };
}

/* --------------------------------------------------------------- SKU --- */

/** The same shape as the till's codes — category, name, strength. */
export function skuBase(name?: string, category?: string): string {
  const safe = (s?: string) => (s || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').trim();
  const parts: string[] = [];
  const cat = safe(category);
  if (cat) {
    const c = (cat.split(/\s+/)[0] || '').replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (c) parts.push(c);
  }
  const nm = safe(name);
  const words = nm.split(/\s+/).filter(Boolean);
  if (words.length) {
    const w1 = (words[0] || '').replace(/[^A-Z0-9]/g, '');
    const w2 = (words[1] || '').replace(/[^A-Z0-9]/g, '');
    let base = (w1.slice(0, 3) + (w2 ? w2.slice(0, 2) : '')).replace(/[^A-Z0-9]/g, '');
    if (!base) base = (w1 || 'PRD').slice(0, 3);
    parts.push(base);
    const num = (nm.match(/\d+/g) || [])[0];
    if (num) parts.push(num.slice(0, 3));
  }
  return (parts.filter(Boolean).join('-') || 'PRD').slice(0, 12);
}

/**
 * A new code in the website's own range, "W-…". The till makes "LK-…" (or
 * whatever letters that PC was given), so the two can add items at the same
 * time and never pick the same code. Checked against every item already in
 * the cloud copy; a clash gets -001, -002 and so on.
 */
export async function makeWebSku(name?: string, category?: string): Promise<string> {
  const base = 'W-' + skuBase(name, category);
  const { data } = await supabase.from('products').select('sku').ilike('sku', base + '%').limit(1000);
  const taken = new Set((data || []).map((r: any) => String(r.sku || '').toUpperCase()));
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base}-${String(n).padStart(3, '0')}`)) n++;
  return `${base}-${String(n).padStart(3, '0')}`;
}

/** Who already uses this code, if anyone other than this product. */
export async function skuOwner(sku: string, exceptId?: string): Promise<string | null> {
  const { data } = await supabase.from('products').select('id,name').eq('sku', sku).limit(2);
  const other = (data || []).find((r: any) => r.id !== exceptId);
  return other ? String(other.name) : null;
}
