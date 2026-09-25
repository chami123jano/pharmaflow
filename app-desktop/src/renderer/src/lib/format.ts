export function formatLKR(amount: number | string | null | undefined): string {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat('en-LK', {
      style: 'currency',
      currency: 'LKR',
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