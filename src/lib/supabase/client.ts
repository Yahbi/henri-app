import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client.
 *
 * ─── Changing these two values requires a REBUILD, not a redeploy ───────
 * `NEXT_PUBLIC_*` is inlined into the client bundle at BUILD time. It is not
 * read from the environment at runtime, so updating the value in Vercel and
 * pressing "Redeploy" is NOT enough — that button reuses the existing build
 * cache, and the previously-inlined literal stays baked into the JavaScript.
 *
 * This bit during the 2026-08-05 key rotation. The dashboard showed the new
 * publishable key, the server was correctly using the new secret key, and the
 * shipped bundle still contained the OLD anon JWT:
 *
 *     /_next/static/chunks/0pjvr~pbqc6s4.js
 *       sb_publishable_ present : 0
 *       legacy eyJ JWT present  : 1
 *
 * Disabling the legacy keys in that state would have broken every
 * browser-side call — auth, dashboard queries, homeowner chat — while the
 * server kept working, which reads as an inexplicable partial outage rather
 * than a key problem.
 *
 * So after changing either value: trigger a build with the cache DISABLED
 * (Vercel's Redeploy dialog has the checkbox), or push a commit that changes
 * a file, then verify the deployed chunk actually carries the new key before
 * revoking the old one:
 *
 *     curl -s https://meethenri.com/_next/static/chunks/<chunk>.js | grep -c sb_publishable_
 *
 * Verify, then revoke. Never the other way round.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function createClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Return a mock client that won't crash but won't do anything
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        signUp: async () => ({ data: { user: null, session: null }, error: { message: "Supabase not configured" } }),
        signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: "Supabase not configured" } }),
        signInWithOAuth: async () => ({ data: { url: null, provider: "" as const }, error: null }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }), order: () => ({ data: [], error: null }) }), order: () => ({ data: [], error: null }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
        update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
      }),
    } as unknown as ReturnType<typeof createBrowserClient>;
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
