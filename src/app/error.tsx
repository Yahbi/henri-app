"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Root-level error boundary. Catches any error thrown during rendering
 * below the App Router's layout — including server-component errors
 * that leak past segment-level boundaries. Prior to this, uncaught
 * errors rendered the Next.js default grey screen, which looks like
 * an infrastructure failure to a paying customer.
 *
 * Segment-level boundaries still exist at:
 *   src/app/(marketing)/error.tsx
 *   src/app/(auth)/error.tsx
 *   src/app/(homeowner)/error.tsx
 *   src/app/onboarding/error.tsx
 * This one is the catch-all for everything else — notably the
 * (dashboard) group.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface errors into whatever observability hook is wired in. Sentry
    // / similar will attach automatically through their own error listener;
    // we just log here for dev visibility.
    console.error("RootError:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h1 className="font-heading text-2xl font-normal tracking-tight text-foreground">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        An unexpected error occurred. Our team has been notified. You can
        retry, head back home, or contact support if this keeps happening.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-muted-foreground/70">
          Ref: <span className="font-mono">{error.digest}</span>
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
