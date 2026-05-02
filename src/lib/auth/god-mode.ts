/**
 * God-mode allowlist helpers.
 *
 * Used by:
 *   - `/api/dev/switch-role`        (role-flipping button in the dev login UX)
 *   - `/api/dev/is-god-mode`        (client-side check — consumed by useLeads)
 *   - `/api/leads/map`              (raises the default pin cap when god-mode)
 *   - `useLeads` hook               (fetches all leads for god-mode, capped by plan otherwise)
 *
 * Subscribers get plan-based caps (Founder 3 ZIPs, Starter 5, Pro 12, Enterprise 20)
 * enforced elsewhere. God-mode users bypass all of that for exploration.
 *
 * Allowlist is read from the GOD_MODE_EMAILS env var (comma-separated) and
 * defaults to the founder's email.
 */

// Founder accounts. y.abismuth = dev/build identity; waspinc20 = the
// production Henri-account email used to actually sign in to the app.
// Both belong to the same person; we keep both so god-mode works
// regardless of which one is signed in.
const DEFAULT_ALLOWLIST = "y.abismuth@gmail.com,waspinc20@gmail.com";

export function isGodModeEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.GOD_MODE_EMAILS ?? DEFAULT_ALLOWLIST;
  const allowed = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

/**
 * Caps for god-mode users. Progressive paint strategy:
 *
 *   MAP_LIMIT_FIRST = first-paint cap — served fast (~2s, single Supabase
 *     page) so the map renders immediately.
 *   MAP_LIMIT_FULL  = background-refresh cap that swaps in after first paint.
 *     Set to the server hard ceiling so dev users see EVERY geocoded lead
 *     in the account, not a truncated 10k slice. The paginated branch in
 *     /api/leads/map handles this via .range() with partial-result
 *     tolerance so statement timeouts on a later page don't blank the map.
 *   PANEL_LIMIT    = left-panel cap. The list is virtualized (manual
 *     windowing) so it renders smoothly regardless of dataset size.
 *
 * 500,000 = the absolute ceiling enforced by /api/leads/map's limit
 * clamp; it's high enough that in practice the fetch exhausts the
 * account before hitting it, so "effectively unlimited for god-mode".
 */
export const GOD_MODE_MAP_LIMIT_FIRST = 2_000;
export const GOD_MODE_MAP_LIMIT_FULL  = 500_000;
export const GOD_MODE_PANEL_LIMIT     = 500_000;

/** Backward-compat alias — callers should prefer MAP_LIMIT_FULL. */
export const GOD_MODE_MAP_LIMIT = GOD_MODE_MAP_LIMIT_FULL;
