# Henri E2E smoke tests

Playwright-powered browser tests that exercise the critical user paths
end-to-end against a real dev server.

## One-time setup

```bash
pnpm add -D @playwright/test
npx playwright install chromium
```

That's 130 MB of browser binary + a few MB of JS. Total install < 150 MB.

## Running

```bash
# Auto-starts `pnpm dev` if nothing is already listening on :3000.
pnpm exec playwright test

# Run a single spec:
pnpm exec playwright test e2e/homeowner-flow.spec.ts

# Interactive mode — step through, inspect DOM, rerun on save:
pnpm exec playwright test --ui

# Against a deployed preview URL instead of local dev:
PLAYWRIGHT_BASE_URL=https://staging.henri.app pnpm exec playwright test
```

## What each spec covers

| Spec | Flow | Why it matters |
|---|---|---|
| `homeowner-flow.spec.ts` | `/` → `/portal` → chat intake form renders | The wedge entry point for homeowners. If /portal 500s, the whole homeowner funnel is dead. |
| `contractor-flow.spec.ts` | `/` → `/contractors` → signup CTA present | Contractor acquisition entry point. Pricing table + trust row must render. |
| `exclusivity.spec.ts` | `/login` → seeded contractor → `/dashboard` → lock + watcher pills | Validates wedge contracts #1 + #6. Graceful-degrades when migration 00031 isn't applied (tests assert both states). |

Add new specs as new flows become critical. Keep each spec under 30 s —
these are smoke tests, not full integration coverage. Unit tests (vitest)
cover logic, Playwright covers "does the page render + do the buttons work."

## CI

Not wired up yet. Runbook:
- GitHub Action triggered on PR open + push to main
- Playwright runs against the Vercel preview URL
- HTML report uploaded as artifact on failure

Left as a follow-up — the specs run locally today.
