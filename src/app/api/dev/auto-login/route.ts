import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";

/**
 * DEV-ONLY one-click login. Creates (or upserts) y.abismuth@gmail.com with a
 * known dev password using the service-role key, marks the email as confirmed
 * (bypassing any "Confirm email" requirement in Supabase), ensures the
 * profiles row exists as a contractor with onboarding completed, then signs
 * the user in by exchanging the password for a session.
 *
 * Gated on `NEXT_PUBLIC_ENABLE_DEV_LOGIN=1` — matches the gate on the
 * /login button. Returns 404 when the flag isn't set so real Vercel
 * deployments (where the flag is never set) can't be hit via direct POST,
 * AND so local production builds (`next start`) still work as long as
 * the user has set the flag in `.env.local`.
 */

const DEV_EMAIL = "y.abismuth@gmail.com";
const DEV_PASSWORD = "DevLogin!2026";

export async function POST() {
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
