import React, { createContext, useContext, useEffect, useState } from 'react';

interface User { id: string; email: string; role: string }
interface AuthCtx { user: User | null; token: string | null; login(email:string,pw:string):Promise<boolean>; logout():void; }

const AuthContext = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User|null>(null);
  const [token, setToken] = useState<string|null>(null);

  useEffect(()=>{
    const t = localStorage.getItem('sessionToken');
    if (t) {
      // auth.me expects only the token parameter; preload shape returns { ok, user }
      if ((window as any).api?.auth?.me) {
        (window as any).api.auth.me(t).then((res: any)=>{
          if(res?.ok && res.user){ setUser(res.user); setToken(t);} else { localStorage.removeItem('sessionToken'); }
        }).catch(()=>{ localStorage.removeItem('sessionToken'); });
      } else {
        console.error('Preload API not available: window.api.auth.me is undefined');
        localStorage.removeItem('sessionToken');
      }
    }
  },[]);

  async function login(email: string, password: string) {
    try {
      if (!(window as any).api?.auth?.login) {
        console.error('Preload API not available: window.api.auth.login is undefined');
        return false;
      }
      const res: any = await (window as any).api.auth.login(email, password);
      if (!res?.ok) return false;
      // login returns { ok, token, user }
      setUser(res.user); setToken(res.token); localStorage.setItem('sessionToken', res.token);
      return true;
    } catch (err) {
      console.error('Login failed', err);
      return false;
    }
  }
  function logout() { setUser(null); setToken(null); localStorage.removeItem('sessionToken'); }

  return <AuthContext.Provider value={{ user, token, login, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth(){ const ctx = useContext(AuthContext); if(!ctx) throw new Error('AuthProvider must wrap tree'); return ctx; }
