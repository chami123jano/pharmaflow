import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { SHOP_NAME } from '../lib/shop';
import { initials } from '../lib/initials';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await signIn(email, password);
    // On success the auth listener swaps this screen out, so there is nothing
    // to do here but stop spinning if it failed.
    if (err) { setError(err); setBusy(false); }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center p-6">
      <div className="mb-7 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold text-white">
          {initials(SHOP_NAME)}
        </span>
        <h1 className="mt-4 text-2xl font-bold">{SHOP_NAME}</h1>
        <p className="muted mt-1 text-sm">Your shop, from anywhere.</p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-6">
        <div>
          <label htmlFor="email" className="faint mb-1.5 block text-[11px] font-bold uppercase tracking-wide">
            Email
          </label>
          <input
            id="email" type="email" autoComplete="username" inputMode="email"
            className="field" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" required autoFocus
          />
        </div>
        <div>
          <label htmlFor="password" className="faint mb-1.5 block text-[11px] font-bold uppercase tracking-wide">
            Password
          </label>
          <input
            id="password" type="password" autoComplete="current-password"
            className="field" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" required
          />
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="faint mt-6 text-center text-xs leading-relaxed">
        This shows a copy of the shop's data. Selling happens at the till, and the till keeps
        working whether this site is up or not.
      </p>
    </div>
  );
}
