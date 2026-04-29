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
 * Signup page. Google OAuth only per CLAUDE.md.
 *
 * Prior version exposed full email/password forms for both homeowners and
 * contractors. Those were removed — collecting profile details at signup
 * added friction and created accounts that couldn't receive the Google
 * profile enrichment (avatar, full name, verified email). All per-role
 * profile data now happens in onboarding instead:
 *   - Homeowners: in /homeowner's first-use flow
 *   - Contractors: in /onboarding/license → /plan → /payment → /territory
 *
 * Terms + Privacy acceptance is required before the OAuth button activates.
 * This is a hard requirement of both Stripe (subscription creation) and
 * Google OAuth consent screen review.
 */

type Role = "homeowner" | "contractor";

function SignupInner() {
  const searchParams = useSearchParams();
  const roleParam = searchParams?.get("role") as Role | null;
  const [role, setRole] = useState<Role>(
    roleParam === "homeowner" || roleParam === "contractor" ? roleParam : "contractor",
  );
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignup() {
    setError(null);
    if (!termsAccepted) {
      setError("You must accept the Terms of Service and Privacy Policy to continue.");
      return;
    }
    const supabase = createClient();
    // Route through /auth/callback so the PKCE code exchange happens
    // server-side and the session cookies get set before the user
    // hits any role-gated route. The `next` param is the post-auth
    // destination; `role` lets the callback stamp `profiles.role`
    // when it creates the row. Homeowners land on their dashboard;
    // contractors enter the onboarding funnel at the license step.
    // (`queryParams` would be passed to Google, not back to us, which
    // is why role is encoded into `redirectTo` instead.)
    const next =
      role === "homeowner" ? "/homeowner?new=1" : "/onboarding/license";
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", next);
    callback.searchParams.set("role", role);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (oauthError) setError(oauthError.message);
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
            Sign up with Google — it&apos;s the only way in.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Role picker */}
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

          {/* Terms acceptance — required before OAuth */}
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
 * Skeleton shown while the client-side SignupInner hydrates. Previously we
 * rendered `null`, which meant a blank screen during Suspense resolution —
 * users landing from /signup?role=... saw nothing for a beat. The skeleton
 * mirrors the final card layout so the transition feels seamless.
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
