"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log the digest to the browser console so the user can screenshot it if
  // they reach out to support. Server-side, the same digest appears in the
  // logs so we can correlate support tickets to actual stack traces.
  useEffect(() => {
    if (error?.digest) {
      console.error("Auth error digest:", error.digest, error);
    }
  }, [error]);

  const supportMailto =
    "mailto:support@meethenri.com?subject=" +
    encodeURIComponent(`Auth error${error?.digest ? ` (${error.digest})` : ""}`) +
    "&body=" +
    encodeURIComponent(
      `Hi Henri team,\n\nI hit an error while signing in.\n\nError: ${error?.message ?? "unknown"}\nDigest: ${error?.digest ?? "n/a"}\nURL: ${typeof window !== "undefined" ? window.location.href : ""}\n\nWhat I was trying to do:\n`,
    );

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div
        className="max-w-md w-full rounded-xl border border-border bg-card p-8 text-center space-y-4 shadow-lg"
        role="alert"
        aria-live="assertive"
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="mx-auto text-destructive"
          aria-hidden="true"
        >
          <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <h1 className="text-xl font-heading font-normal text-foreground">
          Something went wrong
        </h1>
        <p className="text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred while signing you in."}
        </p>

        {error?.digest && (
          <p className="rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">
            Error code: <span className="font-semibold text-foreground">{error.digest}</span>
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-border px-5 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Go home
          </Link>
        </div>

        <p className="pt-2 text-xs text-muted-foreground">
          Still stuck?{" "}
          <a
            href={supportMailto}
            className="underline hover:text-foreground"
          >
            Email support
          </a>
          {" "}— include the error code above.
        </p>
      </div>
    </div>
  );
}
