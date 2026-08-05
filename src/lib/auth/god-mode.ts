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
 * True when this session was established with a PASSWORD.
 *
 * Why this exists: /api/dev/auto-login carried a literal password default and
 * wrote it onto the founder's PRODUCTION account using the service-role key
 * from .env.local. That value is committed to Yahbi/henri-app, which is a
 * PUBLIC repository, so the string has been readable by anyone since commit
 * 91d1400 — and the founder's email is on the line above it, while the
 * Supabase URL and anon key ship in the browser bundle by design. GoTrue's
 * grant_type=password endpoint is public, so that is a complete remote login.
 *
 * God mode is granted by EMAIL, never by a particular credential, so the
 * account can keep god mode while the password stops being a way to reach it.
 * Every genuine founder sign-in on record is `oauth` (verified against
 * auth.mfa_amr_claims on 2026-08-05); the only `password` sessions in the
 * project's history were created by the dev-login route itself. Refusing
 * password-derived sessions therefore costs nothing real.
 *
 * Mirrors the `is_god_mode()` SQL function (migration 00132), which applies
 * the same rule to RLS. Both layers are needed: RLS guards the lead rows,
 * this guards the /api/admin/* routes, and they are separate code paths.
 *
 * Fail-open on ABSENCE, deliberately: if the token carries no `amr` claim we
 * return false (not password) and behave exactly as before. A fail-closed
 * reading would lock the founder out of god mode the moment Supabase renamed
 * a claim. This is defence-in-depth; the primary control is disabling the
 * Email+Password provider.
 */
export function isPasswordSession(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  const payload = accessToken.split(".")[1];
  if (!payload) return false;
  try {
    // The token was already verified by supabase.auth.getUser() before this
    // is reached, so this decode is for CLAIM READING only — it must never
    // be the thing that establishes trust in the token.
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { amr?: Array<{ method?: string }> };
    return Array.isArray(json.amr) && json.amr.some((e) => e?.method === "password");
  } catch {
    // A token we cannot parse tells us nothing about how it was minted.
    // Treat it as "not password" so this never denies a legitimate session.
    return false;
  }
}

/**
 * God mode for a request: the allowlist AND a non-password session.
 *
 * Call this in server routes instead of isGodModeEmail() alone. Pass the
 * session access token from `supabase.auth.getSession()`.
 */
export function isGodModeSession(
  email: string | null | undefined,
  accessToken: string | null | undefined,
): boolean {
  return isGodModeEmail(email) && !isPasswordSession(accessToken);
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
