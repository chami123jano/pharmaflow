/**
 * The shop's name, baked in when the site is built.
 *
 * The desktop keeps this in its database because the till's owner can change
 * it at the counter. A static site has no database to read at startup, so it
 * comes from a build variable instead. The default is the product's own name,
 * so anyone who builds this repo unchanged gets PharmaFlow.
 */
export const SHOP_NAME = (import.meta.env.VITE_SHOP_NAME || 'PharmaFlow').trim();
