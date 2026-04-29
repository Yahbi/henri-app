import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Dev-only one-click login for the seeded dev contractor.
// Refuses to run in production OR on any Vercel deploy.
// Delete this file to remove the shortcut entirely.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Defense-in-depth (P0-2): three independent gates. All must hold for
// the route to fire. Mirrors the pattern in /api/dev/auto-login.
function devLoginAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL_ENV) return false; // any Vercel env is off-limits
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN !== "1") return false;
  return true;
}

export async function GET(request: Request) {
  if (!devLoginAllowed()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json(
      { error: "Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY)" },
      { status: 500 },
    );
  }

  const store = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) =>
        toSet.forEach((c) => store.set(c.name, c.value, c.options)),
    },
  });

  const devEmail = process.env.DEV_LOGIN_EMAIL;
  const devPassword = process.env.DEV_LOGIN_PASSWORD;
  if (!devEmail || !devPassword) {
    return NextResponse.json(
      { error: "DEV_LOGIN_EMAIL / DEV_LOGIN_PASSWORD env vars not set" },
      { status: 500 },
    );
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: devEmail,
    password: devPassword,
  });

  if (error) {
    return NextResponse.json(
      { error: `Dev login failed: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.redirect(new URL("/dashboard/map", request.url));
}
