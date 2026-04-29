"use client";

import { useState } from "react";
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
 * Login page. Google OAuth only, per CLAUDE.md.
 *
 * Prior version also exposed an email/password form via
 * `supabase.auth.signInWithPassword`. That was removed because:
 *   1. Google is the only provider we have consent for in production.
 *   2. Password users don't get auto-populated profiles from Google scopes
 *      (full_name, avatar_url), leaving onboarding half-broken.
 *   3. The forgot-password flow had no email-template wiring.
 */
export default function LoginPage() {
  const [authError, setAuthError] = useState<string | null>(null);

  const signInWithGoogle = async () => {
    setAuthError(null);
    const supabase = createClient();
    // Direct Google → /dashboard would skip the PKCE code-exchange
    // and the session cookies would never be set. Route through
    // /auth/callback (`src/app/auth/callback/route.ts`) which
    // exchanges the code server-side and then forwards to the
    // intended destination via the `next` query param.
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", "/dashboard");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (error) setAuthError(error.message);
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
          <CardDescription>Sign in with your Google account</CardDescription>
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
