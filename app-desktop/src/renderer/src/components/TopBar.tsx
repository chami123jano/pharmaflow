import React from 'react';
import { useAuth } from '../lib/auth';

export default function TopBar(){
  const { user, logout } = useAuth();
  return (
    <header className="h-12 border-b bg-white flex items-center justify-between px-4 text-sm">
      <div className="font-semibold">Dashboard</div>
      <div className="flex items-center gap-3">
        {user && <span>{user.email}</span>}
        {user && <button className="px-2 py-1 rounded bg-red-500 text-white text-xs" onClick={logout}>Logout</button>}
      </div>
    </header>
  );
}
