import { useState, useEffect, useRef } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import KeyboardHelp from './components/KeyboardHelp';
import { useShortcuts } from './hooks/useShortcuts';
import Login from './routes/Login';
import Dashboard from './routes/Dashboard';
import Inventory from './routes/Inventory';
import Contacts from './routes/Contacts';
import ExitGuard from './components/ExitGuard';
import Sales from './routes/Sales';
import Reports from './routes/Reports';
import Users from './routes/Users';
import Settings from './routes/Settings';
import { useShop } from './lib/shop';
import { initials } from './lib/initials';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '[D]', adminOnly: false },
  { key: 'inventory', label: 'Inventory',  icon: '[I]', adminOnly: false },
  { key: 'sales',     label: 'Sales',      icon: '[S]', adminOnly: false },
  { key: 'contacts',  label: 'People',     icon: '[P]', adminOnly: false },
  { key: 'reports',   label: 'Reports',    icon: '[R]', adminOnly: true  },
  { key: 'users',     label: 'Users',      icon: '[U]', adminOnly: true  },
  { key: 'settings',  label: 'Settings',   icon: '[C]', adminOnly: true  },
];

function AppInner() {
  const shop = useShop();
  const [user,            setUser]            = useState<any>(null);
  const [tokens,          setTokens]          = useState<any>(null);
  const [page,            setPage]            = useState('dashboard');
  const [darkMode,        setDarkMode]        = useState(() => JSON.parse(localStorage.getItem('darkMode') || 'false'));
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showHelp,        setShowHelp]        = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { localStorage.setItem('darkMode', JSON.stringify(darkMode)); }, [darkMode]);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) setShowProfileMenu(false);
    }
    if (showProfileMenu) { document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }
  }, [showProfileMenu]);

  // Apply dark mode class on html element
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  function canAccess(key: string): boolean {
    if (!user) return false;
    const nav = NAV.find(n => n.key === key);
    if (!nav) return true;
    if (nav.adminOnly && user.role !== 'admin') return false;
    return true;
  }

  function navigate(key: string) {
    if (canAccess(key)) setPage(key);
  }

  function handleLogin(u: any, t: any) {
    setUser(u); setTokens(t);
    setPage('dashboard');
  }
  function handleLogout() {
    setUser(null); setTokens(null); setPage('dashboard'); setShowProfileMenu(false);
  }

  // ── Global keyboard shortcuts ───────────────────────────────────────────────
  useShortcuts([
    { key:'D', ctrl:true, description:'Dashboard',   group:'Navigation', action:() => navigate('dashboard') },
    { key:'I', ctrl:true, description:'Inventory',   group:'Navigation', action:() => navigate('inventory') },
    { key:'S', ctrl:true, description:'Sales',       group:'Navigation', action:() => navigate('sales'),
      enabled: !(!user) },
    { key:'P', ctrl:true, description:'People',      group:'Navigation', action:() => navigate('contacts') },
    { key:'R', ctrl:true, description:'Reports',     group:'Navigation', action:() => navigate('reports') },
    { key:'U', ctrl:true, description:'Users',       group:'Navigation', action:() => navigate('users') },
    { key:',', ctrl:true, description:'Settings',    group:'Navigation', action:() => navigate('settings') },
    { key:'F1',     description:'Help',      group:'Global', action:() => setShowHelp(s => !s) },
    { key:'Escape', description:'Close help', group:'Global', action:() => setShowHelp(false), enabled: showHelp },
    { key:'F5',     description:'Refresh',   group:'Global', action:() => window.dispatchEvent(new CustomEvent('ph:refresh')) },
  ]);

  function renderPage() {
    if (!user) return <Login onLogin={handleLogin} />;
    switch (page) {
      case 'dashboard': return <Dashboard user={user} tokens={tokens} onQuickNav={navigate} darkMode={darkMode} />;
      case 'inventory': return <Inventory user={user} tokens={tokens} darkMode={darkMode} />;
      case 'sales':     return <Sales user={user} tokens={tokens} darkMode={darkMode} />;
      case 'contacts':  return <Contacts user={user} darkMode={darkMode} />;
      case 'reports':   return canAccess('reports') ? <Reports user={user} tokens={tokens} darkMode={darkMode} /> : null;
      case 'users':     return canAccess('users')   ? <Users user={user} tokens={tokens} darkMode={darkMode} onUserChanged={()=>{}} /> : null;
      case 'settings':  return canAccess('settings') ? <Settings user={user} tokens={tokens} darkMode={darkMode} /> : null;
      default:          return <Dashboard user={user} tokens={tokens} onQuickNav={navigate} darkMode={darkMode} />;
    }
  }

  const visibleNav = user ? NAV.filter(n => !n.adminOnly || user.role === 'admin') : [];

  return (
    <div className={`min-h-screen transition-colors duration-300 ${darkMode ? 'dark bg-slate-900' : 'bg-slate-100/70'}`}>
      {/* Mounted above everything: the close prompt must appear whatever screen
          the cashier happens to be on, and even before they have signed in. */}
      <ExitGuard darkMode={darkMode} />
      {/* Top nav */}
      <nav className={`fixed w-full z-50 border-b backdrop-blur-md transition-colors duration-300 ${
        darkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white/85 border-slate-200'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm shadow-blue-500/30">{initials(shop.name)}</div>
              <span className={`text-lg font-bold tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>{shop.name}</span>
            </div>

            {/* Nav items */}
            {user && (
              <div className="hidden md:flex items-center gap-1">
                {visibleNav.map(item => (
                  <button
                    key={item.key}
                    onClick={() => navigate(item.key)}
                    title={`${item.label} — Ctrl+${item.icon.replace(/[\[\]]/g, '')}`}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
                      page === item.key
                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                        : darkMode
                          ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Right: F1 help, dark mode, profile */}
            {user && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowHelp(s => !s)}
                  title="Keyboard shortcuts (F1)"
                  className={`px-2 py-1.5 rounded-lg text-xs font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  F1
                </button>
                <button
                  onClick={() => setDarkMode((d: boolean) => !d)}
                  className={`p-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    darkMode ? 'bg-gray-700 text-yellow-400 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {darkMode ? '[L]' : '[D]'}
                </button>

                {/* Profile */}
                <div className="relative" ref={profileMenuRef}>
                  <button
                    onClick={() => setShowProfileMenu(s => !s)}
                    className={`flex items-center gap-2 p-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                    }`}
                  >
                    <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                      {(user.name || user.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="hidden md:block text-left">
                      <div className={`text-sm font-medium leading-tight ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                        {user.name || user.email?.split('@')[0]}
                      </div>
                      <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {user.role}
                      </div>
                    </div>
                    <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>▼</span>
                  </button>

                  {showProfileMenu && (
                    <div className={`absolute right-0 mt-2 w-52 rounded-xl shadow-lg ring-1 ring-black/5 z-50 overflow-hidden ${
                      darkMode ? 'bg-gray-800 ring-gray-700' : 'bg-white'
                    }`}>
                      <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-100'}`}>
                        <p className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                          {user.name || user.email?.split('@')[0]}
                        </p>
                        <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{user.email}</p>
                        <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                          user.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                        }`}>{user.role}</span>
                      </div>
                      {user.role === 'admin' && (
                        <button onClick={() => { navigate('settings'); setShowProfileMenu(false); }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                          [C] Settings
                        </button>
                      )}
                      <button onClick={() => { setDarkMode((d: boolean) => !d); setShowProfileMenu(false); }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                        {darkMode ? '[L] Light Mode' : '[D] Dark Mode'}
                      </button>
                      <div className={`border-t ${darkMode ? 'border-gray-700' : 'border-gray-100'}`}>
                        <button onClick={handleLogout}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${darkMode ? 'text-red-400 hover:bg-gray-700' : 'text-red-600 hover:bg-red-50'}`}>
                           Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className={`${user ? 'pt-16' : ''} min-h-screen`}>
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          {renderPage()}
        </div>
      </main>

      {/* Keyboard help overlay */}
      {showHelp && <KeyboardHelp onClose={() => setShowHelp(false)} darkMode={darkMode} />}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </ErrorBoundary>
  );
}
