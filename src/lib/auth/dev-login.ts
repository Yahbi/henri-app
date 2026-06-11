/**
 * Centralized dev-login gate.
 *
 * Both dev-login routes (`/api/dev/auto-login`, `/api/dev/login`) previously
 * reimplemented the same triple-gate. This is the single source of truth.
 *
 * Defense-in-depth: all three checks must hold for the route to open.
 *   1. NOT in production (`NODE_ENV !== "production"`).
 *   2. NOT on any Vercel-managed deployment (`VERCEL_ENV` unset). Vercel sets
 *      VERCEL_ENV=production|preview|development for every deploy; local
 *      `pnpm dev` leaves it unset, so the route only opens locally.
 *   3. `NEXT_PUBLIC_ENABLE_DEV_LOGIN=1` — matches the gate on the /login UI.
 *
 * Logic is byte-for-byte identical to the prior inline copies — this just
 * centralizes it.
 */
export function isDevLoginAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL_ENV) return false; // any Vercel env (incl. preview) is off-limits
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN !== "1") return false;
  return true;
}
