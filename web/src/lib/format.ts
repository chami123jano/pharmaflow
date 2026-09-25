/** Sri Lankan rupees, the way a receipt reads. */
export function lkr(n: number | null | undefined): string {
  const v = Number(n || 0);
  return 'Rs. ' + v.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compact form for headline numbers, where two decimals are just noise. */
export function lkrShort(n: number | null | undefined): string {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return 'Rs. ' + (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 10_000) return 'Rs. ' + Math.round(v / 1000) + 'k';
  return 'Rs. ' + v.toLocaleString('en-LK', { maximumFractionDigits: 0 });
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function dayName(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

/**
 * Local midnight as an ISO instant.
 *
 * "Today" has to mean today in Sri Lanka, not in UTC. Between 00:00 and 05:30
 * local the two disagree, and a naive UTC boundary would quietly file the
 * night's last sales under yesterday.
 */
export function startOfDay(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** How close an expiry is, in plain words. */
export function expiryState(expiry: string | null): { label: string; tone: 'bad' | 'warn' | 'ok' | 'none' } {
  if (!expiry) return { label: 'No date', tone: 'none' };
  const days = Math.round((new Date(expiry).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, tone: 'bad' };
  if (days === 0) return { label: 'Expires today', tone: 'bad' };
  if (days <= 30) return { label: `${days}d left`, tone: 'warn' };
  if (days <= 90) return { label: `${Math.round(days / 30)}mo left`, tone: 'warn' };
  return { label: new Date(expiry).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), tone: 'ok' };
}
