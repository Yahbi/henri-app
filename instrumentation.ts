/**
 * Next.js instrumentation hook — runs once on server startup in both
 * Node.js and Edge runtimes. Canonical place for telemetry initialisation.
 *
 * Today this wires up the error-tracker sink in `src/lib/logger.ts`. The
 * sink is a no-op by default; registering a real adapter here means every
 * `logger.error(...)` call in cron routes, webhook handlers, and API
 * endpoints starts forwarding to the tracker automatically.
 *
 * ## Enabling Sentry (one of several possible trackers)
 *
 *   1. `pnpm add @sentry/nextjs`
 *   2. Set SENTRY_DSN in .env.local / Vercel env vars.
 *   3. Uncomment the Sentry block below. `npx @sentry/wizard` also works
 *      but it adds a `.sentryclirc` + regenerates this file; prefer the
 *      manual wiring so the error-sink contract stays explicit.
 *
 * ## Enabling Datadog / Axiom / your own tracker
 *
 * Same pattern — `registerErrorSink((message, meta) => { ... })` with
 * whatever the tracker's capture API is. One sink at a time today.
 *
 * ## Why the gate on NEXT_RUNTIME
 *
 * This file runs in BOTH server (Node.js) and Edge runtimes. Some error
 * trackers only ship a Node bundle; importing them in Edge builds
 * produces a "cannot resolve module" build error. The runtime guard
 * short-circuits Edge until each tracker catches up.
 */

export async function register(): Promise<void> {
  // Short-circuit Edge runtime — most error-tracker SDKs only support Node.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Error-tracker adapter. Gate on the tracker's specific env var so we
  // never try to initialise a disabled tracker.
  //
  // --- Sentry ---
  // Active 2026-04-26 (Phase 2.5 of the post-audit roadmap). The dynamic
  // import is wrapped in try/catch so the build doesn't fail when
  // `@sentry/nextjs` isn't yet installed — production deploys that have
  // run `pnpm add @sentry/nextjs` AND set SENTRY_DSN start aggregating
  // automatically. The structured logger keeps printing JSON to Vercel
  // log ingestion regardless.
  if (process.env.SENTRY_DSN) {
    try {
      // `@sentry/nextjs` is an optional dependency. The dynamic import
      // specifier is hidden behind a Function-constructor wrapper so the
      // bundler (Turbopack / webpack) can't statically resolve the
      // module path at build time — without this, a clean clone that
      // hasn't run `pnpm add @sentry/nextjs` floods the dev server with
      // "Module not found" warnings even though the runtime gate above
      // means the code never executes. The Function trick keeps the
      // `import()` opaque to static analysis; runtime resolution still
      // works when the package is installed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dynImport = new Function("s", "return import(s)") as (s: string) => Promise<any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Sentry: any = await dynImport("@sentry/nextjs").catch(() => null);
      if (!Sentry || typeof Sentry.init !== "function") return;

      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
        // Traces + replays add cost — start with a low rate, tune after
        // looking at actual Sentry usage dashboards.
        tracesSampleRate: 0.1,
        // Tag every event with the deploy SHA for release correlation.
        release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
      });

      const { registerErrorSink } = await import("@/lib/logger");
      registerErrorSink((message, meta) => {
        try {
          Sentry.captureException(new Error(message), { extra: meta ?? {} });
        } catch {
          // Defensive: a broken Sentry SDK never breaks the request.
        }
      });
    } catch {
      // Catch-all: any boot failure (missing module, bad DSN format,
      // etc.) is silent. The app keeps running; observability just
      // isn't aggregated until the issue is fixed.
    }
  }
}
