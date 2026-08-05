import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isGodModeEmail } from "@/lib/auth/god-mode";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Fast path: API routes authenticate themselves in their handlers via
  // supabase.auth.getUser(), and static assets never need middleware. Short-
  // circuit to avoid the ~50-150ms auth roundtrip per request. This matters
  // because React Query and page loads can fire many API calls per nav.
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  // Public marketing routes — keep session refresh so cookies roll forward,
  // but don't perform role-based redirects.
  const publicPaths = ["/portal", "/contractors", "/login", "/signup", "/"];
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return updateSessionOnly(request);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured: allow in dev, block in production
  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Service temporarily unavailable", { status: 503 });
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  // God-mode bypass: the founder + dev allowlist skips all onboarding
  // gating so they can preview the fully-provisioned dashboard without
  // having a live Stripe subscription. Everyone else still hits the
  // license → plan → payment → territory gates below.
  if (user && isGodModeEmail(user.email)) {
    // Audit S6 fix (2026-04-27): structured audit log for god-mode
    // bypass — every entry is a privileged short-circuit through
    // middleware gating. Without this, a compromised god-mode email
    // (or a misconfigured GOD_MODE_EMAILS env var) leaves no audit
    // trail. Use console.warn directly because middleware runs on
    // Edge runtime and `@/lib/logger` is not Edge-compatible.
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "god-mode bypass invoked",
        email: user.email,
        user_id: user.id,
        path: pathname,
        ip: request.headers.get("x-forwarded-for") ?? "unknown",
        ts: new Date().toISOString(),
      }),
    );
    return response;
  }

  // Contractor-only surfaces, for both the auth gate and the role gate
  // below.
  //
  // `/settings/*` is the trap here: those pages live at
  // src/app/(dashboard)/settings/**, so they LOOK dashboard-scoped in the
  // source tree, but `(dashboard)` is a Next.js route GROUP — it
  // contributes nothing to the URL. The real path is /settings/billing,
  // which no `startsWith("/dashboard")` check ever matched. Result: every
  // gate below (auth, role, onboarding-step) skipped the entire settings
  // surface, so a homeowner could open contractor billing and a
  // contractor mid-onboarding could reach it before paying.
  //
  // Note this is distinct from /dashboard/settings/*, a SEPARATE set of
  // pages under src/app/(dashboard)/dashboard/settings/** which were
  // always covered by the /dashboard prefix.
  const isContractorPath =
    pathname.startsWith("/dashboard") || pathname.startsWith("/settings");

  // Protected routes: require authentication
  if (!user) {
    if (isContractorPath || pathname.startsWith("/homeowner") || pathname.startsWith("/onboarding")) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // Role-based routing + per-step onboarding gating.
  //
  // Prior middleware only blocked /dashboard when onboarding wasn't
  // complete. That let a user open /onboarding/territory directly and
  // skip license + plan + payment, because the territory page sets
  // onboarding_completed=true unconditionally. Now we check the
  // prerequisites for each onboarding step up-front and redirect to the
  // first unmet step.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, onboarding_completed, license_state, plan, stripe_customer_id")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "contractor";
  const onboardingDone = profile?.onboarding_completed ?? false;

  // Helper: redirect with a user-facing reason. Downstream pages can read
  // ?reason=... and surface a toast so the redirect is never silent.
  const redirectWithReason = (target: string, reason: string) => {
    const url = new URL(target, request.url);
    url.searchParams.set("reason", reason);
    return NextResponse.redirect(url);
  };

  // Contractor trying to access homeowner area → redirect to dashboard
  if (role === "contractor" && pathname.startsWith("/homeowner")) {
    return redirectWithReason("/dashboard", "contractor_area");
  }

  // Homeowner trying to access contractor dashboard or settings → redirect
  if (role === "homeowner" && isContractorPath) {
    return redirectWithReason("/homeowner", "homeowner_area");
  }

  // Homeowner trying to access contractor onboarding → redirect to homeowner
  if (role === "homeowner" && pathname.startsWith("/onboarding")) {
    return redirectWithReason("/homeowner", "homeowner_area");
  }

  // Contractor who hasn't completed onboarding → redirect to onboarding.
  // Covers /settings/* too: it is a contractor surface reachable before
  // payment, and /settings/billing in particular was loadable mid-funnel.
  if (role === "contractor" && !onboardingDone && isContractorPath) {
    return redirectWithReason("/onboarding/license", "onboarding_required");
  }

  // Per-step onboarding gating — enforce the license → plan → payment →
  // territory order so a URL-guessing user can't skip ahead. Each step
  // reads a prerequisite column populated by the previous step:
  //   /onboarding/plan      requires profiles.license_state IS NOT NULL
  //   /onboarding/payment   requires profiles.plan IS NOT NULL
  //   /onboarding/territory requires profiles.stripe_customer_id IS NOT NULL
  // Without these guards, the territory step can flip onboarding_completed
  // and the user lands on a paid dashboard without ever paying.
  if (role === "contractor" && !onboardingDone) {
    if (pathname.startsWith("/onboarding/plan") && !profile?.license_state) {
      return redirectWithReason("/onboarding/license", "step_license_required");
    }
    if (pathname.startsWith("/onboarding/payment") && !profile?.plan) {
      return redirectWithReason("/onboarding/plan", "step_plan_required");
    }
    if (pathname.startsWith("/onboarding/territory") && !profile?.stripe_customer_id) {
      return redirectWithReason("/onboarding/payment", "step_payment_required");
    }
  }

  return response;
}

/* Session refresh only (for public routes) */
async function updateSessionOnly(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
