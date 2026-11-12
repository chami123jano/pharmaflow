import { supabase } from '../lib/supabase'; // this spelling so the preview can stand in for it

/**
 * Reads for the owner's newer pages — returns, cash-ups, deliveries, costs.
 *
 * These tables arrive with supabase/add-owner-pages.sql. Until that has been
 * run they do not exist, and a query for them fails; the pages then say what
 * to do instead of showing an error, and everything older keeps working.
 */
export interface Loaded<T> { rows: T[]; missing: boolean; error?: string }

const isMissing = (msg?: string) => /does not exist|could not find|schema cache|column .* not exist/i.test(msg || '');

export async function load<T>(table: string, select: string, from?: string, opts: { order?: string; limit?: number } = {}): Promise<Loaded<T>> {
  let q = supabase.from(table).select(select);
  if (from) q = q.gte('created_at', from);
  q = q.order(opts.order || 'created_at', { ascending: false }).limit(opts.limit || 5000);
  const { data, error } = await q;
  if (error) return { rows: [], missing: isMissing(error.message), error: isMissing(error.message) ? undefined : error.message };
  return { rows: (data || []) as T[], missing: false };
}

/** Rows whose `col` is in `ids`, chunked so the URL never gets too long. */
export async function loadIn<T>(table: string, select: string, col: string, ids: string[]): Promise<Loaded<T>> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from(table).select(select).in(col, ids.slice(i, i + 200));
    if (error) return { rows: out, missing: isMissing(error.message), error: isMissing(error.message) ? undefined : error.message };
    out.push(...((data || []) as T[]));
  }
  return { rows: out, missing: false };
}

export const SETUP_TEXT =
  'This page needs one more step in Supabase: open SQL Editor, paste the contents of supabase/add-owner-pages.sql, and press Run. Then sync the till once.';
