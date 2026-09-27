/**
 * Money, the way a Sri Lankan bill reads it.
 *
 * "Rs." rather than the ISO code "LKR": that is what the receipt prints, what
 * the website shows, and what anyone at the counter would write. Having the
 * till alone say LKR made the same figure look like two different things.
 */
export function formatLKR(amount: number | string | null | undefined): string {
  const n = Number(amount || 0);
  try {
    return 'Rs. ' + new Intl.NumberFormat('en-LK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Fallback
    return `Rs ${n.toFixed(2)}`;
  }
}

export function formatLKRShort(amount: number | string | null | undefined): string {
  const n = Number(amount || 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `Rs ${(n / 1_000).toFixed(1)}k`;
  return formatLKR(n);
}