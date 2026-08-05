import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { isDevLoginAllowed } from "@/lib/auth/dev-login";

/**
 * DEV-ONLY one-click login. Creates (or upserts) y.abismuth@gmail.com using
 * the service-role key, marks the email as confirmed (bypassing any "Confirm
 * email" requirement in Supabase), ensures the profiles row exists as a
 * contractor with onboarding completed, then signs the user in by minting a
 * magic-link OTP server-side and exchanging it for a session.
 *
 * PASSWORDLESS. This used to create a known dev password and sign in with a
 * password grant; that wrote a repo-committed credential onto the PRODUCTION
 * account, because .env.local's service-role key points at production. The
 * OTP path needs no credential at all — see the note above step 3.
 *
 * Defense-in-depth gating (P0-1):
 *   1. `NEXT_PUBLIC_ENABLE_DEV_LOGIN=1` — matches the gate on the /login UI.
 *   2. NOT in production (`NODE_ENV !== "production"`) — even if a Vercel
 *      env mis-config sets ENABLE_DEV_LOGIN=1, the production NODE_ENV
 *      blocks the route. Both gates must hold.
 *   3. NOT on a Vercel-managed deployment (`VERCEL_ENV` unset). Vercel
 *      sets VERCEL_ENV=production|preview|development for every deploy.
 *      Local pnpm dev leaves it unset, so the route only opens locally.
 *
 * If any of the three checks fails, return 404 — same shape as a non-
 * existent route, so attackers can't fingerprint the gate.
 */

const DEV_EMAIL = "y.abismuth@gmail.com";

export async function POST() {
  if (!isDevLoginAllowed()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // NO PASSWORD IS INVOLVED IN THIS ROUTE ANY MORE.
  //
  // It used to default to a literal committed password and call
  // admin.auth.admin.updateUserById(user.id, { password }) on every run. The
  // comment defending that argued the route only executes when NODE_ENV !==
  // production and VERCEL_ENV is unset, so a hardcoded default "can never
  // activate on any deploy". True, and beside the point: the route does not
  // write to a local database. It writes with the SERVICE-ROLE key from
  // .env.local, which points at the PRODUCTION Supabase project. "Local only"
  // described where the code ran, not which database it mutated.
  //
  // Production auth.users on 2026-08-05 showed y.abismuth@gmail.com with
  // encrypted_password NOT NULL and last_sign_in_at 20:44:13Z — written by
  // this route during a local session. Yahbi/henri-app is a PUBLIC repo, so
  // that credential was world-readable, and GoTrue's grant_type=password
  // endpoint is public.
  //
  // The session is now established with a magic-link OTP minted server-side
  // (see step 3). That removes the credential entirely rather than making it
  // configurable — a DEV_LOGIN_PASSWORD env var would still have written a
  // password into production auth, just a different one.

  try {
    const admin = createAdminClient();

    // 1. Find or create the auth user. Use listUsers → filter; if not found,
    //    create with email_confirm: true so login works immediately.
    const { data: existing } = await admin.auth.admin.listUsers();
    let user = existing.users.find(
      (u) => u.email?.toLowerCase() === DEV_EMAIL.toLowerCase()
    );

    if (!user) {
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email: DEV_EMAIL,
          email_confirm: true,
          user_metadata: { role: "contractor", full_name: "Dev Owner" },
        });
      if (createErr || !created.user) {
        logApiError("dev.autoLogin.createUser", createErr);
        return NextResponse.json({ error: "Create failed" }, { status: 500 });
      }
      user = created.user;
    } else {
      // Confirm the email so the OTP exchange below succeeds. NOTE the
      // password is NOT written here any more — see the header block.
      await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
    }

    // 2. Ensure the profiles row exists as a contractor with onboarding done.
    await admin.from("profiles").upsert(
      {
        id: user.id,
        email: DEV_EMAIL,
        full_name: "Dev Owner",
        role: "contractor",
        plan: "founder",
        onboarding_completed: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    // 3. Establish the session with a MAGIC-LINK OTP, not a password grant.
    //
    // generateLink() mints a one-time token server-side with the service-role
    // key; verifyOtp() exchanges it and sets the Supabase auth cookies on the
    // response. Same one-click result, three things better:
    //
    //   - No password is created, stored, or needed, so this route can no
    //     longer write a credential into whatever project the service-role
    //     key points at. That is what put a repo-committed password on the
    //     founder's PRODUCTION account.
    //   - The session's amr is `otp`, not `password`, so it KEEPS god mode
    //     under the session-aware check in is_god_mode() (migration 00132)
    //     and isGodModeSession(). A password grant would now be refused —
    //     dev login would work but the dashboard would be missing every
    //     god-mode surface, which is a confusing way to fail.
    //   - It matches the product's own stated posture: passwordless only.
    //
    // The token never leaves the server, so it cannot be intercepted, and
    // this route is already unreachable outside a local `pnpm dev`.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: DEV_EMAIL,
    });
    if (linkErr || !link?.properties?.email_otp) {
      logApiError("dev.autoLogin.generateLink", linkErr);
      return NextResponse.json({ error: "Could not mint dev session" }, { status: 500 });
    }

    const supabase = await createClient();
    const { error: signInErr } = await supabase.auth.verifyOtp({
      email: DEV_EMAIL,
      token: link.properties.email_otp,
      type: "email",
    });
    if (signInErr) {
      logApiError("dev.autoLogin.signIn", signInErr);
      return NextResponse.json({ error: "Sign-in failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      email: DEV_EMAIL,
      redirect: "/dashboard",
    });
  } catch (err) {
    logApiError("dev.autoLogin", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
