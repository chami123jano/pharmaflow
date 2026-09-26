import { useState } from 'react';
import { useAuth, canSeeMoney } from './lib/auth';
import { Spinner } from './components/ui';
import { SHOP_NAME } from './lib/shop';
import { initials } from './lib/initials';
import Login from './routes/Login';
import Today from './routes/Today';
import Reports from './routes/Reports';
import Products from './routes/Products';
import Stock from './routes/Stock';

type Page = 'today' | 'reports' | 'products' | 'stock';

const PAGES: { key: Page; label: string; icon: string; ownerOnly?: boolean }[] = [
  { key: 'today', label: 'Today', icon: '●', ownerOnly: true },
  { key: 'reports', label: 'Reports', icon: '▤', ownerOnly: true },
  { key: 'products', label: 'Products', icon: '◇' },
  { key: 'stock', label: 'Stock', icon: '▦' },
];

export default function App() {
  const { session, role, loading, unlisted, signOut } = useAuth();
  const [page, setPage] = useState<Page>('today');

  if (loading) return <Spinner label="Checking your login…" />;
  if (!session) return <Login />;

  // Signed in, but nobody has said who they are. Every policy checks app_users,
  // so this account would see blank screens everywhere — say so instead.
  if (unlisted) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 p-6">
        <div className="card p-6 text-center">
          <p className="text-4xl">🔒</p>
          <h1 className="mt-3 text-lg font-bold">This account has no access yet</h1>
          <p className="muted mt-2 text-sm">
            The login worked, but it has not been given a role. The owner needs to add it in
            Supabase before it can see anything.
          </p>
          <p className="faint mt-3 break-all text-xs">{session.user.email}</p>
          <button onClick={signOut} className="btn-ghost mt-5 w-full">Sign out</button>
        </div>
      </div>
    );
  }

  const owner = canSeeMoney(role);
  const visible = PAGES.filter((p) => owner || !p.ownerOnly);
  // A staff member landing on a page they cannot see would get an empty screen.
  const current = visible.some((p) => p.key === page) ? page : visible[0].key;

  return (
    <div className="min-h-full pb-24 sm:pb-8">
      <header className="safe-top sticky top-0 z-30 border-b backdrop-blur" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg) 88%, transparent)' }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">{initials(SHOP_NAME)}</span>
            <div>
              <p className="text-sm font-bold leading-tight">{SHOP_NAME}</p>
              <p className="faint text-[11px] leading-tight">{owner ? 'Owner' : 'Staff'}</p>
            </div>
          </div>

          <nav className="hidden gap-1 sm:flex">
            {visible.map((p) => (
              <button
                key={p.key}
                onClick={() => setPage(p.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  current === p.key ? 'bg-blue-600 text-white' : 'muted hover:opacity-70'
                }`}
              >
                {p.label}
              </button>
            ))}
          </nav>

          <button onClick={signOut} className="faint text-xs font-semibold hover:opacity-70">
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {current === 'today' && <Today />}
        {current === 'reports' && <Reports />}
        {current === 'products' && <Products />}
        {current === 'stock' && <Stock />}
      </main>

      {/* Thumb-reachable on a phone; the header handles it on a desktop. */}
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t backdrop-blur sm:hidden"
        style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg) 92%, transparent)' }}
      >
        {visible.map((p) => (
          <button
            key={p.key}
            onClick={() => setPage(p.key)}
            className={`flex flex-1 flex-col items-center gap-0.5 pt-2.5 text-[11px] font-bold transition ${
              current === p.key ? 'text-blue-600 dark:text-blue-400' : 'faint'
            }`}
          >
            <span className="text-base leading-none">{p.icon}</span>
            {p.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
