import { useState, useEffect, useRef } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import KeyboardHelp from './components/KeyboardHelp';
import { useShortcuts } from './hooks/useShortcuts';
import Login from './routes/Login';
import Dashboard from './routes/Dashboard';
import Inventory from './routes/Inventory';
import Receive from './routes/Receive';
import Contacts from './routes/Contacts';
import ExitGuard from './components/ExitGuard';
import Sales from './routes/Sales';
import Reports from './routes/Reports';
import Users from './routes/Users';
import Settings from './routes/Settings';
import { useShop } from './lib/shop';
import Logo from './components/Logo';
import Icon, { type IconName } from './components/Icon';

const NAV: { key: string; label: string; icon: IconName; shortcut: string; adminOnly: boolean }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home',     shortcut: 'Ctrl+D', adminOnly: false },
  { key: 'sales',     label: 'Sales',     icon: 'cart',     shortcut: 'Ctrl+S', adminOnly: false },
  { key: 'inventory', label: 'Inventory', icon: 'package',  shortcut: 'Ctrl+I', adminOnly: false },
  { key: 'receive',   label: 'Receive stock', icon: 'truck', shortcut: 'Ctrl+G', adminOnly: false },
  { key: 'contacts',  label: 'People',    icon: 'users',    shortcut: 'Ctrl+P', adminOnly: false },
  { key: 'reports',   label: 'Reports',   icon: 'chart',    shortcut: 'Ctrl+R', adminOnly: true  },
  { key: 'users',     label: 'Users',     icon: 'shield',   shortcut: 'Ctrl+U', adminOnly: true  },
  { key: 'settings',  label: 'Settings',  icon: 'settings', shortcut: 'Ctrl+,', adminOnly: true  },
];

function AppInner() {
  const shop = useShop();
  const [user,            setUser]            = useState<any>(null);
  const [tokens,          setTokens]          = useState<any>(null);
  const [page,            setPage]            = useState('dashboard');
  const [darkMode,        setDarkMode]        = useState(() => JSON.parse(localStorage.getItem('darkMode') || 'false'));
  const [collapsed,       setCollapsed]       = useState(() => {
    try { return JSON.parse(localStorage.getItem('sidebarCollapsed') || 'false'); } catch { return false; }
  });
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showHelp,        setShowHelp]        = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { localStorage.setItem('darkMode', JSON.stringify(darkMode)); }, [darkMode]);
  useEffect(() => { try { localStorage.setItem('sidebarCollapsed', JSON.stringify(collapsed)); } catch {} }, [collapsed]);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) setShowProfileMenu(false);
    }
    if (showProfileMenu) { document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }
  }, [showProfileMenu]);

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
    { key:'G', ctrl:true, description:'Receive stock (GRN)', group:'Navigation', action:() => navigate('receive') },
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
      case 'receive':   return <Receive user={user} darkMode={darkMode} />;
      case 'contacts':  return <Contacts user={user} darkMode={darkMode} />;
      case 'reports':   return canAccess('reports') ? <Reports user={user} tokens={tokens} darkMode={darkMode} /> : null;
      case 'users':     return canAccess('users')   ? <Users user={user} tokens={tokens} darkMode={darkMode} onUserChanged={()=>{}} /> : null;
      case 'settings':  return canAccess('settings') ? <Settings user={user} tokens={tokens} darkMode={darkMode} /> : null;
      default:          return <Dashboard user={user} tokens={tokens} onQuickNav={navigate} darkMode={darkMode} />;
    }
  }

  const visibleNav = user ? NAV.filter(n => !n.adminOnly || user.role === 'admin') : [];
  const displayName = user ? (user.name || user.username || user.email?.split('@')[0] || 'User') : '';

  /*
   * The sidebar is navy in both themes: it is the frame, and a frame that flips
   * colour with the content behind it stops reading as a frame. Labels sit in
   * the DOM even when collapsed (visually hidden), so screen readers and the
   * keyboard-help overlay still find every destination by name.
   */
  const navBtn = (active: boolean) =>
    `group relative w-full flex items-center gap-3 rounded-xl text-sm font-medium transition-colors ${
      collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
    } ${active
      ? 'bg-white/10 text-white'
      : 'text-navy-200 hover:bg-white/5 hover:text-white'}`;

  return (
    <div className={`h-screen flex overflow-hidden ${darkMode ? 'dark bg-slate-950' : 'bg-slate-50'}`}>
      {/* Mounted above everything: the close prompt must appear whatever screen
          the cashier happens to be on, and even before they have signed in. */}
      <ExitGuard darkMode={darkMode} />

      {/* ─────────────────────────────────────────────── Sidebar ─── */}
      {user && (
        <aside className={`shrink-0 flex flex-col bg-navy-900 dark:bg-navy-950 border-r border-white/5 transition-[width] duration-200 ${
          collapsed ? 'w-[72px]' : 'w-60'
        }`}>
          {/* Brand */}
          <div className={`flex items-center gap-3 h-16 shrink-0 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
            <Logo size={36} mark={shop.mark} className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-white leading-tight truncate">{shop.name}</div>
                <div className="text-[11px] text-navy-300 leading-tight">Point of sale</div>
              </div>
            )}
          </div>

          {/* Destinations */}
          <nav className={`flex-1 min-h-0 overflow-y-auto py-3 space-y-1 ${collapsed ? 'px-3' : 'px-3'}`} aria-label="Main">
            {visibleNav.map(item => {
              const active = page === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  title={`${item.label} (${item.shortcut})`}
                  className={navBtn(active)}
                >
                  {/* the bar on the left edge marks where you are */}
                  {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-lime-400" aria-hidden="true" />}
                  <Icon name={item.icon} size={20} className={active ? 'text-lime-300' : 'text-navy-300 group-hover:text-white'} />
                  <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
                  {!collapsed && (
                    <kbd className="ml-auto text-[10px] font-medium text-navy-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      {item.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Utilities */}
          <div className="shrink-0 px-3 pb-3 space-y-1 border-t border-white/5 pt-3">
            <button onClick={() => setShowHelp(s => !s)} title="Keyboard shortcuts (F1)" className={navBtn(false)}>
              <Icon name="keyboard" size={20} className="text-navy-300 group-hover:text-white" />
              <span className={collapsed ? 'sr-only' : ''}>Shortcuts</span>
              {!collapsed && <kbd className="ml-auto text-[10px] font-medium text-navy-400">F1</kbd>}
            </button>
            <button onClick={() => setDarkMode((d: boolean) => !d)} title={darkMode ? 'Light mode' : 'Dark mode'} className={navBtn(false)}>
              <Icon name={darkMode ? 'sun' : 'moon'} size={20} className="text-navy-300 group-hover:text-white" />
              <span className={collapsed ? 'sr-only' : ''}>{darkMode ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button onClick={() => setCollapsed((c: boolean) => !c)} title={collapsed ? 'Expand menu' : 'Collapse menu'} className={navBtn(false)}>
              <Icon name={collapsed ? 'expand' : 'collapse'} size={20} className="text-navy-300 group-hover:text-white" />
              <span className={collapsed ? 'sr-only' : ''}>{collapsed ? 'Expand' : 'Collapse'}</span>
            </button>

            {/* Who is signed in */}
            <div className="relative pt-2" ref={profileMenuRef}>
              <button
                onClick={() => setShowProfileMenu(s => !s)}
                className={`w-full flex items-center gap-3 rounded-xl p-2 hover:bg-white/5 transition-colors ${collapsed ? 'justify-center' : ''}`}
                title={displayName}
              >
                <span className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-white text-sm font-semibold grid place-items-center ring-2 ring-white/10">
                  {displayName.charAt(0).toUpperCase()}
                </span>
                {!collapsed && (
                  <>
                    <span className="min-w-0 text-left">
                      <span className="block text-sm font-medium text-white truncate">{displayName}</span>
                      <span className="block text-[11px] text-navy-300 capitalize">{user.role}</span>
                    </span>
                    <Icon name="chevronUp" size={16} className="ml-auto text-navy-400" />
                  </>
                )}
              </button>

              {showProfileMenu && (
                <div className={`absolute bottom-full mb-2 ${collapsed ? 'left-0' : 'left-0 right-0'} w-56 rounded-xl shadow-raised ring-1 overflow-hidden z-50 ${
                  darkMode ? 'bg-slate-800 ring-slate-700' : 'bg-white ring-slate-200'
                }`}>
                  <div className={`px-4 py-3 border-b ${darkMode ? 'border-slate-700' : 'border-slate-100'}`}>
                    <p className={`text-sm font-semibold ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>{displayName}</p>
                    <p className={`text-xs ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{user.username || user.email}</p>
                  </div>
                  {user.role === 'admin' && (
                    <button onClick={() => { navigate('settings'); setShowProfileMenu(false); }}
                      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${darkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                      <Icon name="settings" size={16} /> Settings
                    </button>
                  )}
                  <button onClick={handleLogout}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm border-t transition-colors ${
                      darkMode ? 'text-red-400 hover:bg-slate-700 border-slate-700' : 'text-red-600 hover:bg-red-50 border-slate-100'}`}>
                    <Icon name="logout" size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* ─────────────────────────────────────────────── Content ─── */}
      <main className="flex-1 min-w-0 h-screen overflow-y-auto">
        <div className={user ? 'max-w-[1600px] mx-auto px-6 py-5 min-h-full' : ''}>
          {renderPage()}
        </div>
      </main>

      {showHelp && <KeyboardHelp onClose={() => setShowHelp(false)} darkMode={darkMode} />}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <AppInner />
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
