/**
 * Playwright config for Henri E2E smoke tests.
 *
 * ## How to use this (one-time install)
 *
 *   pnpm add -D @playwright/test
 *   npx playwright install chromium    # chromium-only keeps install small
 *   pnpm exec playwright test          # runs everything in e2e/
 *
 * ## What the smoke tests cover (see e2e/*.spec.ts)
 *
 *   - homeowner-flow.spec.ts   — public → /portal → signup as homeowner
 *   - contractor-flow.spec.ts  — public → /contractors → signup as contractor
 *   - exclusivity.spec.ts      — /dashboard renders lock + watcher badges
 *                                 (no-op when migration 00031 not applied)
 *
 * ## Why Playwright, not Cypress?
 *
 *   Built for Next.js 16 + React 19 (first-party support), headless
 *   chromium install is 130 MB (vs Cypress's 500 MB+), runs ~3x faster
 *   on the same box, and shares the `page.evaluate()` ergonomics with
 *   the `Claude_in_Chrome` MCP we already use for interactive tests.
 *
 * ## CI integration (left for later)
 *
 *   GitHub Actions workflow will run these against a preview deploy —
 *   see `vercel.json` for the current cron/deploy setup. Today we run
 *   locally via `pnpm exec playwright test` before pushing.
 *
 * NB: this file is intentionally NOT imported by anything else — it's
 * playwright CLI's own config discovery that picks it up. Safe to
 * commit as-is; it's a no-op until @playwright/test is installed.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Explicit testMatch — only `*.spec.ts` files inside `./e2e`. Without
  // this pin, Playwright's default testMatch
  // (`**/*.@(spec|test).?(c|m)[jt]s?(x)`) walks the whole repo and picks
  // up vitest tests under `src/**/__tests__/*.test.ts`, which crash with
  // "Vitest cannot be imported in a CommonJS module using require()" in
  // the e2e CI job. Pinning the pattern keeps Playwright in its lane and
  // lets vitest tests live anywhere they want.
  testMatch: "**/*.spec.ts",
  // Fail fast in CI, retry-once locally — flaky tests hide real bugs.
  retries: process.env.CI ? 0 : 1,
  // Full parallelisation — our tests are stateless (no shared DB writes).
  fullyParallel: true,
  // Report to both terminal (interactive) and HTML (CI).
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    // Trace + screenshots on first failure — keeps the HTML report useful
    // without ballooning artifact size on green runs.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // mobile-safari project removed for the initial smoke pass — needs
    // `npx playwright install webkit` to land. Re-enable once we have
    // a CI step that installs all three engines, OR if a mobile-only
    // bug surfaces from the field.
  ],

  // Local dev server command — Playwright auto-starts it before the
  // first test, auto-stops after the suite. `reuseExistingServer` lets
  // developers keep `pnpm dev` running in another terminal.
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
