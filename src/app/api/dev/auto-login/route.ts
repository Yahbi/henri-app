import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { isDevLoginAllowed } from "@/lib/auth/dev-login";

/**
 * DEV-ONLY one-click login. Creates (or upserts) y.abismuth@gmail.com with a
 * known dev password using the service-role key, marks the email as confirmed
 * (bypassing any "Confirm email" requirement in Supabase), ensures the
 * profiles row exists as a contractor with onboarding completed, then signs
 * the user in by exchanging the password for a session.
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

  // Password from env, with a LOCAL-ONLY fallback. Safe: we only reach here
  // after isDevLoginAllowed() guaranteed NODE_ENV !== production AND
  // VERCEL_ENV unset AND ENABLE_DEV_LOGIN=1 — i.e. a local `pnpm dev`. The
  // fallback can never activate on any deploy, so it re-enables one-click
  // local login without a manual env step (a hard-require with no fallback
  // silently 404'd local dev login out of the box).
  const DEV_PASSWORD = process.env.DEV_LOGIN_PASSWORD || "DevLogin!2026";

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
          password: DEV_PASSWORD,
          email_confirm: true,
          user_metadata: { role: "contractor", full_name: "Dev Owner" },
        });
      if (createErr || !created.user) {
        logApiError("dev.autoLogin.createUser", createErr);
        return NextResponse.json(
          { error: createErr?.message ?? "Create failed" },
          { status: 500 }
        );
      }
      user = created.user;
    } else {
      // Reset the password so we always know it and mark email confirmed.
      await admin.auth.admin.updateUserById(user.id, {
        password: DEV_PASSWORD,
        email_confirm: true,
      });
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

    // 3. Sign in via password grant against the session-aware server client.
    //    This sets the Supabase auth cookies on the response.
    const supabase = await createClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
    });
    if (signInErr) {
      logApiError("dev.autoLogin.signIn", signInErr);
      return NextResponse.json(
        { error: signInErr.message },
        { status: 500 }
      );
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
