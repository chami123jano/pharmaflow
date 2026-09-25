import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set at build time');
}

/**
 * The browser's connection to the mirror.
 *
 * This key is public — it ships inside the JavaScript and anyone can read it.
 * On its own it opens nothing: every table has row level security and an
 * unauthenticated request matches no policy, so it comes back empty. What a
 * person may see is decided by their row in app_users, server side, where the
 * browser cannot argue with it.
 */
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
