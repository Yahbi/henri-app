"use client";

import { useEffect } from "react";

/**
 * Global error boundary — catches errors that leak past `app/error.tsx`
 * (which only runs once the root layout has mounted). When the layout
 * itself throws (RootProviders, ThemeProvider, font loading, etc.) Next.js
 * needs a fallback that renders its own `<html>` + `<body>` shell. That's
 * what this file provides.
 *
 * Distinction from `app/error.tsx`:
 *   - `error.tsx` runs INSIDE the root layout. Renders into `<body>`.
 *   - `global-error.tsx` REPLACES the root layout entirely. Owns `<html>`.
 *
 * Per Next.js docs: "global-error.tsx must include `<html>` and `<body>`
 * tags, since it is replacing the root layout when active."
 *
 * Intentionally NO Tailwind / CSS-var dependencies in the styles — those
 * load via the layout that just crashed. Inline styles + system font keep
 * the page renderable when the rest of the bundle is broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry's instrumentation hook auto-captures via its global error
    // listener; this console.error is for dev visibility when SENTRY_DSN
    // is unset.
    console.error("GlobalError (root layout crashed):", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Something went wrong | Henri.</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          backgroundColor: "#0d0c0a",
          color: "#f5efe7",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "32rem", textAlign: "center" }}>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              marginBottom: "0.5rem",
            }}
          >
            Henri.
          </div>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 400,
              margin: "1rem 0 0.5rem",
              letterSpacing: "-0.02em",
            }}
          >
            Something went seriously wrong
          </h1>
          <p
            style={{
              fontSize: "0.95rem",
              opacity: 0.75,
              margin: "0 0 1rem",
              lineHeight: 1.5,
            }}
          >
            The app hit an error before it could render its layout. Our team
            has been notified. You can retry below or come back in a few
            minutes.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                opacity: 0.5,
                margin: "0 0 1rem",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
              }}
            >
              Ref: {error.digest}
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "0.625rem 1rem",
                borderRadius: "0.5rem",
                border: "none",
                backgroundColor: "#D4886A",
                color: "#1a1612",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* Intentional `<a>` instead of next/link <Link> (audit-04-30
              * fix #7 acknowledgement): global-error.tsx REPLACES the root
              * layout when active. The Next.js router context is part of
              * what crashed; using <Link> here would either fail to render
              * or trigger a second layout-mount that crashes again. A
              * raw <a> with `href="/"` does a full page reload, which is
              * EXACTLY what we want here — recover from a layout crash
              * by tearing the broken React tree down and rebooting from
              * scratch. The lint rule doesn't know this context. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                padding: "0.625rem 1rem",
                borderRadius: "0.5rem",
                border: "1px solid rgba(245, 239, 231, 0.2)",
                color: "#f5efe7",
                fontSize: "0.875rem",
                fontWeight: 500,
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
