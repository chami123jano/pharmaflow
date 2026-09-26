/**
 * The two letters that stand in for the shop.
 *
 * "Rx" was the old mark — the pharmacist's symbol, from the Latin *recipe*,
 * "take thou". Correct for a pharmacy in general, but it says nothing about
 * *this* shop, and two different pharmacies would wear the same badge. The
 * initials are derived instead, so the mark follows the name with nothing to
 * keep in step by hand.
 *
 *   "Chamindu Pharmacy" -> CP
 *   "PharmaFlow"        -> PF   (the internal capital counts as a word)
 *   "Nimal"             -> NI
 */
export function initials(name: string): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return '??';

  const words = cleaned
    // Split "PharmaFlow" as well as "Chamindu Pharmacy".
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s\-_.]+/)
    .filter(Boolean);

  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
}
