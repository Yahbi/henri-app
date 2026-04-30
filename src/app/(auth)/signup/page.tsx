"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

/**
 * Signup page. Two passwordless paths per CLAUDE.md (2026-04-29 brand-rule
 * amendment after Pro upgrade): Google OAuth + magic-link email. Both
 * preserve the "no passwords to leak" trust posture; magic-link unlocks
 * contractors who don't use Gmail (Outlook / Yahoo / corporate email).
 *
 * Prior version was Google-only and gated all non-Gmail contractors out.
 *
 * URL-param contract:
 *   ?role=contractor|homeowner — pre-selects audience (default: contractor)
 *   ?plan=founder|starter|pro|enterprise — pre-selects subscription tier
 *
 * Behavior matrix:
 *   /signup                      → role chooser visible, no plan chip
 *   /signup?role=contractor      → role chooser visible (single-button
 *                                   arrival, e.g. landing CTA)
 *   /signup?role=homeowner       → role chooser visible
 *   /signup?role=contractor&plan=pro → role chooser HIDDEN, plan chip shown
 *                                       (came from /pricing)
 *
 * Plan param is forwarded into onboarding via `next=/onboarding/license?plan=…`
 * so the plan-step pre-fills the contractor's choice.
 */

type Role = "homeowner" | "contractor";
type PlanKey = "founder" | "starter" | "pro" | "enterprise";

/* Plan label + price for the confirmation chip. Source-of-truth for prices
 * lives in CLAUDE.md + the pricing page; mirrored here for the inline chip
 * so we don't have to fetch when rendering signup. If this drifts, the
 * truthfulness scan (`pnpm truthfulness`) will catch it. */
const PLAN_DISPLAY: Record<PlanKey, { label: string; price: string; tagline: string }> = {
  founder:    { label: "Founder",    price: "$149/mo",    tagline: "3 ZIPs · Beta · price locked forever" },
  starter:    { label: "Starter",    price: "$749/mo",    tagline: "5 ZIPs · 24-hour free trial" },
  pro:        { label: "Pro",        price: "$1,499/mo",  tagline: "12 ZIPs · Most popular" },
  enterprise: { label: "Enterprise", price: "$2,555/mo",  tagline: "20 ZIPs · Priority support" },
};

function isPlanKey(v: string | null | undefined): v is PlanKey {
  return v === "founder" || v === "starter" || v === "pro" || v === "enterprise";
}

function SignupInner() {
  const searchParams = useSearchParams();
  const roleParam = searchParams?.get("role") as Role | null;
  const planParamRaw = searchParams?.get("plan") ?? null;
  const planParam: PlanKey | null = isPlanKey(planParamRaw) ? planParamRaw : null;

  const [role, setRole] = useState<Role>(
    roleParam === "homeowner" || roleParam === "contractor" ? roleParam : "contractor",
  );
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Magic-link path state */
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSending, setMagicSending] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  /* When the user came from /pricing they already chose a plan AND a role
   * (plans are contractor-only per CLAUDE.md), so the role toggle is
   * redundant + confusing ("Why am I being asked again?"). Hide it in
   * that case. The chip below the title confirms what they're signing up
   * for. Standalone /signup or single-param arrivals still see the toggle. */
  const showRoleChooser = !(roleParam === "contractor" && planParam !== null);

  /* Plan is contractor-only (CLAUDE.md architecture rule). If a homeowner
   * URL somehow includes a plan param, ignore it — the chip would be a lie. */
  const effectivePlan: PlanKey | null = role === "contractor" ? planParam : null;
  const planChip = effectivePlan ? PLAN_DISPLAY[effectivePlan] : null;

  /* Build the post-auth destination. Plan param flows through to
   * onboarding so the plan step pre-fills the contractor's choice. */
  function buildNextPath(): string {
    if (role === "homeowner") return "/homeowner?new=1";
    const base = "/onboarding/license";
    return effectivePlan ? `${base}?plan=${effectivePlan}` : base;
  }

  async function handleGoogleSignup() {
    setError(null);
    if (!termsAccepted) {
      setError("You must accept the Terms of Service and Privacy Policy to continue.");
      return;
    }
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", buildNextPath());
    callback.searchParams.set("role", role);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (oauthError) setError(oauthError.message);
  }

  /* Magic-link signup. Supabase Email OTP routes through the same
   * `/auth/callback` handler that processes the OAuth code-exchange —
   * `exchangeCodeForSession` works for OTP codes too. The `role` param
   * on the callback URL ensures the new profile gets stamped correctly
   * (callback handler at `src/app/auth/callback/route.ts:75-105`). */
  async function handleMagicLink() {
    setError(null);
    if (!termsAccepted) {
      setError("You must accept the Terms of Service and Privacy Policy to continue.");
      return;
    }
    const trimmed = magicEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setMagicSending(true);
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", buildNextPath());
    callback.searchParams.set("role", role);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: callback.toString(),
        /* Supabase default: the email contains a "token hash" link that,
         * when clicked, hits a Supabase URL which then redirects to
         * `emailRedirectTo` with `?code=…`. From the user's perspective
         * it's identical to OAuth — click the link, land logged-in. */
      },
    });
    setMagicSending(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setMagicSent(true);
  }

  return (
    <div className="w-full max-w-md px-4">
      <Card variant="default" className="w-full">
        <CardHeader className="text-center">
          <Link
            href="/"
            className="mb-2 inline-block font-heading text-2xl font-medium tracking-tight text-primary"
          >
            Henri.
          </Link>
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>
            Passwordless sign-up — Google or email magic link.
          </CardDescription>

          {planChip && (
            <div
              className="mx-auto mt-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-08 px-3 py-1 text-xs text-foreground"
              role="status"
            >
              <span className="font-semibold text-primary">{planChip.label}</span>
              <span aria-hidden="true" className="h-3 w-px bg-border" />
              <span className="font-medium">{planChip.price}</span>
              <span aria-hidden="true" className="hidden sm:inline h-3 w-px bg-border" />
              <span className="hidden sm:inline text-muted-foreground">
                {planChip.tagline}
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Role picker — hidden when /pricing-arrival has already chosen
           * contractor + a plan (showRoleChooser=false). Standalone /signup
           * or single-param arrivals still see it. */}
          {showRoleChooser && (
            <div>
              <label className="text-sm font-medium text-foreground">
                I am a
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["contractor", "homeowner"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={cn(
                      "rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                      role === r
                        ? "border-primary bg-primary-08 text-primary"
                        : "border-border text-foreground hover:bg-accent",
                    )}
                  >
                    {r === "contractor" ? "Contractor" : "Homeowner"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {role === "contractor"
                  ? "Get construction-permit leads in your ZIP. 24-hour free trial, cancel anytime."
                  : "Get matched with vetted contractors for your project. Free to use."}
              </p>
            </div>
          )}

          {/* Terms acceptance — required before either signup path activates */}
          <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-border text-primary accent-primary"
              aria-label="Accept Terms of Service and Privacy Policy"
            />
            <span>
              I agree to Henri&apos;s{" "}
              <Link href="/terms" target="_blank" className="underline hover:text-foreground">
                Terms of Service
              </Link>
              ,{" "}
              <Link href="/privacy" target="_blank" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
              , and{" "}
              <Link href="/acceptable-use" target="_blank" className="underline hover:text-foreground">
                Acceptable Use Policy
              </Link>
              .
            </span>
          </label>

          {error && (
            <div
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          )}

          {magicSent ? (
            <div
              className="rounded-lg border border-primary/30 bg-primary-08 px-4 py-3 text-sm text-foreground"
              role="status"
              aria-live="polite"
            >
              <p className="font-medium">Check your email.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                We sent a sign-in link to{" "}
                <span className="font-medium text-foreground">{magicEmail}</span>.
                Click the link to finish creating your account. The link expires in 1 hour.
              </p>
              <button
                type="button"
                onClick={() => {
                  setMagicSent(false);
                  setMagicEmail("");
                }}
                className="mt-2 text-xs text-primary underline hover:text-primary/80"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <Button
                variant="primary"
                type="button"
                className="w-full"
                onClick={handleGoogleSignup}
                disabled={!termsAccepted}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Sign up with Google
              </Button>

              {/* Or divider + magic-link path. Single email field with
               * "Send sign-in link" CTA. Submit fires Supabase Email OTP. */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-2 text-xs text-muted-foreground">
                    or use email
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <input
                  type="email"
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  autoComplete="email"
                  inputMode="email"
                  disabled={magicSending}
                />
                <Button
                  variant="outline"
                  type="button"
                  className="w-full"
                  onClick={handleMagicLink}
                  disabled={!termsAccepted || magicSending || !magicEmail}
                >
                  {magicSending ? "Sending link…" : "Email me a sign-in link"}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">
                  We&apos;ll email you a one-time link. No password needed.
                </p>
              </div>
            </>
          )}
        </CardContent>

        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-primary hover:underline"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

/**
 * Skeleton shown while the client-side SignupInner hydrates. Mirrors the
 * final card layout so the transition from /pricing → /signup feels seamless.
 */
function SignupSkeleton() {
  return (
    <div className="w-full max-w-md px-4">
      <Card variant="default" className="w-full" aria-busy="true">
        <CardHeader className="text-center">
          <div className="mb-2 inline-block font-heading text-2xl font-medium tracking-tight text-primary">
            Henri.
          </div>
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>Loading sign-up options…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
          </div>
          <div className="h-12 animate-pulse rounded-md bg-muted" />
          <span className="sr-only">Loading sign-up form</span>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<SignupSkeleton />}>
      <SignupInner />
    </Suspense>
  );
}
