/**
 * Next.js client-side instrumentation hook (introduced in Next 15.3, used here on Next 16).
 *
 * Runs ONCE on every page load AFTER the HTML document is loaded and BEFORE
 * React hydration begins. Canonical place for browser observability init.
 *
 * Today this wires `@sentry/nextjs` for client-side error capture so any
 * uncaught React error, async exception, or Promise rejection from a
 * homeowner intake / dashboard / onboarding page surfaces in the same
 * Sentry project as the server-side errors emitted by `logger.error()`
 * via the sink registered in `instrumentation.ts`.
 *
 * Together the two files provide full-stack error capture:
 *
 *   - `instrumentation.ts`         → server runtime (Node.js API routes,
 *                                     cron jobs, server components,
 *                                     Server Actions). Captures via the
 *                                     logger sink.
 *   - `instrumentation-client.ts`  → browser runtime (this file).
 *                                     Captures via Sentry's auto-attach
 *                                     to `window.onerror` +
 *                                     `unhandledrejection`.
 *
 * Setup:
 *   1. `pnpm add @sentry/nextjs` (already in package.json:43)
 *   2. Set `NEXT_PUBLIC_SENTRY_DSN` in `.env.local` and Vercel env.
 *   3. Both server (`SENTRY_DSN`) and client (`NEXT_PUBLIC_SENTRY_DSN`)
 *      DSNs should match — they're the same project.
 *
 * Why two env vars: Next.js only inlines `NEXT_PUBLIC_*` vars to the
 * client bundle. The server-side instrumentation reads `SENTRY_DSN`
 * (kept private). The client-side reads `NEXT_PUBLIC_SENTRY_DSN`
 * (intentionally exposed — Sentry's threat model accepts public DSNs;
 * the project ID is validated server-side at the ingestion endpoint).
 *
 * Why static import: dynamic import on the client would mean the SDK
 * doesn't load until after hydration; errors during hydration would
 * escape capture. The bundler dead-code-eliminates the `Sentry.init`
 * branch when `NEXT_PUBLIC_SENTRY_DSN` is unset (build-time inline
 * makes the `if` resolve to `false` and the whole branch tree-shakes).
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    /* Traces sample rate — keep low until we have a Sentry usage
     * baseline. 0.1 = 10% of transactions captured. Bump after
     * looking at actual traffic vs. Sentry quota. */
    tracesSampleRate: 0.1,
    /* Session Replay recording is deliberately OFF.
     *
     * Context: the Sentry client chunk measured 145 KB gzip / 453 KB raw on
     * production 2026-08-05 and is referenced by /, /contractors, /pricing
     * and /login alike — the largest single asset on the site, shipped to
     * every anonymous marketing visitor.
     *
     * Be clear about what removing the sample rates does and does not buy,
     * because it is easy to assume it fixes the size problem and it does
     * not. Rebuilt and measured after this change: the chunk is still
     * 453,809 bytes and still contains the Replay code. @sentry/nextjs adds
     * the integration to its client defaults, and the documented way to drop
     * it is the bundler define `__SENTRY_EXCLUDE_REPLAY__`, which Turbopack
     * in this Next version has no hook for — `turbopack` accepts only
     * `rules` / `resolveAlias` / `resolveExtensions`, no `define`.
     *
     * What this DOES buy is runtime, not bytes: with no sample rate the
     * integration never arms, so no replay buffer is retained and no DOM
     * mutation observers run on any page. That is worth having on its own,
     * for a product with no paying users yet and a 5k-events/month tier.
     *
     * Getting the 145 KB back needs one of: migrating this build off
     * Turbopack, a `resolveAlias` stub for the replay module (fragile — the
     * SDK imports it internally), or Sentry shipping a replay-free client
     * entry point. Tracked, not solved. Error capture, the load-bearing
     * part, is unaffected and stays fully enabled below. */
    /* Tag every event with the deploy SHA for release correlation
     * with the server-side instrumentation. */
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    /* Don't capture noisy / known-irrelevant errors. The list grows
     * once we see real traffic; start conservative. */
    ignoreErrors: [
      // ResizeObserver loop limit exceeded — benign browser quirk.
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      // Network noise (offline / closed tab / etc.) — not actionable.
      "NetworkError when attempting to fetch resource",
      "Failed to fetch",
      "Load failed",
    ],
  });
}

/**
 * Add a breadcrumb on every Next router transition so when an error
 * fires we have the full nav history leading up to it. Wedge bullet #2
 * (transparent confidence) means a contractor reporting "the drawer
 * crashed when I clicked the score badge" should land in Sentry with
 * the exact path: `/dashboard → /dashboard/leads/abc123 → click`.
 */
export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  Sentry.addBreadcrumb({
    category: "navigation",
    message: `${navigationType} → ${url}`,
    level: "info",
    data: { url, navigationType },
  });
}
