"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

/**
 * Login page. Two passwordless paths per CLAUDE.md (2026-04-29 brand-rule
 * amendment): Google OAuth + magic-link email. Both preserve the "no
 * passwords to leak" trust posture. Magic-link unlocks contractors who
 * don't use Gmail (Outlook / Yahoo / corporate email).
 *
 * Both paths route through the same `/auth/callback` handler — Supabase's
 * `exchangeCodeForSession` works for OAuth codes AND magic-link OTP codes.
 */
export default function LoginPage() {
  const [authError, setAuthError] = useState<string | null>(null);

  /* Magic-link state */
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSending, setMagicSending] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  /* 2026-06-10 journey fix: middleware sends users here with
   * ?redirect=<original destination> and the OAuth callback reports
   * failures with ?error=... — both were previously ignored, so users
   * lost their destination (e.g. a homeowner's project link) and failed
   * code exchanges looked like a silent bounce. Only same-origin
   * relative paths are honored (open-redirect guard). */
  const getNextTarget = (): string => {
    const r = new URLSearchParams(window.location.search).get("redirect");
    return r && r.startsWith("/") && !r.startsWith("//") ? r : "/dashboard";
  };

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (!err) return;
    // Microtask defer keeps the effect body setState-free (React 19 lint);
    // cancellation-guarded like the other hooks in this codebase.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setAuthError(
        "Sign-in didn't complete — please try again. If it keeps happening, request a fresh link.",
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", getNextTarget());
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (error) setAuthError(error.message);
  };

  /* Magic-link sign-in. Supabase Email OTP routes through the same
   * `/auth/callback` handler that processes OAuth (`exchangeCodeForSession`
   * accepts both code types). Existing users land directly on /dashboard;
   * never-onboarded contractors get bounced to /onboarding/license by
   * middleware (the role-gated routing already handles that). */
  const sendMagicLink = async () => {
    setAuthError(null);
    const trimmed = magicEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setAuthError("Enter a valid email address.");
      return;
    }
    setMagicSending(true);
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", getNextTarget());

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: callback.toString() },
    });
    setMagicSending(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    setMagicSent(true);
  };

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
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Passwordless sign-in — Google or email link</CardDescription>
        </CardHeader>

        <CardContent>
          {authError && (
            <div
              className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {authError}
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
                Click it to sign in. The link expires in 1 hour.
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
                variant="outline"
                type="button"
                className="w-full"
                onClick={signInWithGoogle}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </Button>

              {/* Or divider + magic-link path */}
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-2 text-xs text-muted-foreground">
                    or use email
                  </span>
                </div>
              </div>

              {/* a11y (2026-08-04): the field had only a placeholder, so it
                * announced as an unlabelled edit box once the user typed
                * (placeholders are not accessible names). Added a visually
                * hidden label bound by id. */}
              <div className="space-y-2">
                <label htmlFor="magic-link-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="magic-link-email"
                  type="email"
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendMagicLink();
                  }}
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
                  onClick={sendMagicLink}
                  disabled={magicSending || !magicEmail}
                >
                  {magicSending ? "Sending link…" : "Email me a sign-in link"}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">
                  No password needed. We&apos;ll send a one-time link.
                </p>
              </div>

              <p className="mt-4 text-center text-xs text-muted-foreground">
                By continuing, you agree to the{" "}
                <Link href="/terms" className="underline hover:text-foreground">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="underline hover:text-foreground">
                  Privacy Policy
                </Link>
                .
              </p>
            </>
          )}

          {/* Dev-only one-click login.
           *
           * Gated on an EXPLICIT env flag (NEXT_PUBLIC_ENABLE_DEV_LOGIN=1)
           * rather than NODE_ENV !== "production" — Vercel preview builds
           * run as `development` NODE_ENV but are public on a branch URL,
           * and exposing a god-mode auto-login there is a launch blocker.
           * Set the flag only on localhost .env.local. */}
          {process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "1" && (
            <Button
              variant="outline"
              type="button"
              className="mt-6 w-full border-dashed"
              onClick={async () => {
                setAuthError(null);
                const res = await fetch("/api/dev/auto-login", {
                  method: "POST",
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => null);
                  setAuthError(data?.error ?? "Dev login failed");
                  return;
                }
                const data = (await res.json()) as { redirect?: string };
                window.location.href = data.redirect ?? "/dashboard";
              }}
            >
              Dev Login (owner)
            </Button>
          )}
        </CardContent>

        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="font-medium text-primary hover:underline"
            >
              Sign up
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
