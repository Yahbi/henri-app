import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * Google OAuth (PKCE) callback handler.
 *
 * Supabase's `signInWithOAuth()` paired with `@supabase/ssr` runs the
 * PKCE flow. After the user finishes signing in at Google's consent
 * screen, Google redirects to Supabase's `/auth/v1/callback`, which
 * then redirects HERE with `?code=XXX` (plus optional `?next=/path`
 * and `?role=contractor|homeowner`).
 *
 * We MUST exchange the code for a session server-side — that's what
 * sets the `sb-access-token` and `sb-refresh-token` cookies on
 * `meethenri.com`. Without this exchange, the browser lands on the
 * intended page with `?code=...` in the URL but no session cookies,
 * the middleware sees no authenticated user, and bounces back to
 * `/login`. The signup page comment on `signup/page.tsx:53` always
 * referenced "the /auth/callback handler" — that handler is THIS file.
 *
 * Flow:
 *   1. Read `code`, `next`, `role` from query params
 *   2. exchangeCodeForSession(code) — sets cookies via server client
 *   3. If signup with role, upsert profiles.role (best-effort)
 *   4. Redirect to `next` destination
 *
 * Error paths all redirect to `/login?error=...` so the user can see
 * a meaningful message rather than getting stuck on a broken page.
 *
 * @see https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextRaw = searchParams.get("next") ?? "/dashboard";
  const role = searchParams.get("role");
  const errParam = searchParams.get("error");
  const errDesc = searchParams.get("error_description");

  // OAuth provider returned an error (e.g. user clicked "Cancel" on the
  // Google consent screen, or Google rejected the client_id).
  if (errParam) {
    logger.warn("OAuth callback received provider error", {
      error: errParam,
      description: errDesc,
    });
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errDesc ?? errParam)}`,
    );
  }

  if (!code) {
    logger.warn("OAuth callback hit without code param", { url: request.url });
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logger.error("OAuth code exchange failed", { error: error.message });
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Stamp profiles.role if the signup flow passed one. Best-effort:
  // any failure here is logged but doesn't block the redirect — the
  // onboarding ladder + profile-creation trigger handle the missing
  // case downstream. Without this, the `profiles` row would be
  // created without a role, and middleware would default the user to
  // contractor (per `middleware.ts:104` `?? "contractor"`), which
  // breaks the homeowner flow.
  if (
    data.user &&
    (role === "contractor" || role === "homeowner")
  ) {
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: data.user.id,
            role,
            email: data.user.email ?? null,
            full_name: data.user.user_metadata?.full_name ?? null,
            avatar_url: data.user.user_metadata?.avatar_url ?? null,
          },
          { onConflict: "id" },
        );
      if (profileError) {
        logger.warn("profile role stamp failed (non-fatal)", {
          user_id: data.user.id,
          role,
          error: profileError.message,
        });
      }
    } catch (e) {
      logger.warn("profile role stamp threw (non-fatal)", {
        user_id: data.user.id,
        role,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Validate `next` is a relative path on our origin to prevent
  // open-redirect (an attacker putting `?next=https://evil.com` would
  // otherwise hijack the post-auth redirect). Anything that doesn't
  // start with `/` falls back to /dashboard.
  const safeNext =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//")
      ? nextRaw
      : "/dashboard";

  return NextResponse.redirect(`${origin}${safeNext}`);
}
