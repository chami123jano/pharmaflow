import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Role = 'owner' | 'staff';

interface AuthState {
  session: Session | null;
  role: Role | null;
  /** True until we know both whether there is a session and what it may do. */
  loading: boolean;
  /** Signed in but with no row in app_users — no policy will match them. */
  unlisted: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlisted, setUnlisted] = useState(false);

  /**
   * The role comes from the database, never from the browser.
   *
   * It decides what this page bothers to render; the policies decide what the
   * database will actually hand over. Hiding a button is a courtesy, not a
   * defence — a staff member who edits this value still gets nothing back.
   */
  async function loadRole(s: Session | null) {
    if (!s) { setRole(null); setUnlisted(false); return; }
    const { data, error } = await supabase
      .from('app_users').select('role').eq('user_id', s.user.id).maybeSingle();
    if (error || !data) { setRole(null); setUnlisted(true); return; }
    setRole(data.role === 'owner' ? 'owner' : 'staff');
    setUnlisted(false);
  }

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadRole(data.session);
      if (alive) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, s) => {
      if (!alive) return;
      setSession(s);
      await loadRole(s);
      setLoading(false);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!error) return null;
    // Supabase says "Invalid login credentials" for both a wrong password and
    // an unknown address, on purpose — repeating it plainly is the honest
    // thing, and guessing which it was would leak who has an account.
    return error.message === 'Invalid login credentials'
      ? 'That email and password do not match.'
      : error.message;
  }

  async function signOut() { await supabase.auth.signOut(); }

  return (
    <Ctx.Provider value={{ session, role, loading, unlisted, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** Money and takings are the owner's business. */
export const canSeeMoney = (role: Role | null) => role === 'owner';
