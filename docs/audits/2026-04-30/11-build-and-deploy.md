# 11 — Build & deploy (2026-04-30)

## TL;DR

`vercel.json` 17 → 20 crons (4 enrich slots after today). `.github/workflows/ci.yml:50` `NEXT_PUBLIC_APP_URL` placeholder corrected to `https://meethenri.com` (was `https://henri.app` on 04-29 — closed). **GitHub Actions CI is failing** on `lint --max-warnings=0` due to 18 pre-existing errors in `scripts/_archive/*.ts` + `src/hooks/useDrawerResize.ts:166` (set-state-in-effect) + `src/app/global-error.tsx:130` (`<a>` instead of `<Link>`). **Vercel deployment uses its own build pipeline** (independent of GitHub Actions); production is serving `1437f86`.

## Score

**WATCH** — IMPROVED on CI domain placeholder, still failing on CI lint job (pre-existing).

## Findings

**F1** | **High** | `src/hooks/useDrawerResize.ts:166` — React 19 lint hard-fail
- **Issue**: `setState()` called synchronously inside `useEffect` body. New React 19 lint rule `react-hooks/set-state-in-effect` fires hard.
  ```ts
  useEffect(() => {
    if (!dragging.current) {
      setLocalHeight(Math.max(minHeight, height || minHeight));
    }
  }, [height, minHeight]);
  ```
- **Why it matters**: GitHub Actions CI fails on this. Cascading renders can hurt performance.
- **Recommended fix**: Replace effect with `useMemo`:
  ```ts
  const derivedHeight = useMemo(
    () => Math.max(minHeight, height || minHeight),
    [height, minHeight]
  );
  ```
  Or move the assignment to the dragend handler. ~30 min.

**F2** | **High** | `src/app/global-error.tsx:130` — `@next/next/no-html-link-for-pages`
- **Issue**: `<a href="/">Home</a>` instead of `<Link href="/">Home</Link>`.
- **Why it matters**: GitHub Actions CI lint fails. Bypasses Next.js client-side navigation.
- **Recommended fix**: Replace with `<Link>` from `next/link`. 1 line. ~2 min.

**F3** | **Medium** | 16 lint errors in `scripts/_archive/*.ts` + `scripts/_recompute-*.ts` etc. — all pre-existing
- **Issue**: 16 errors across archived/private scripts (`_archive/audit-content.ts`, `_archive/backfill-score-signals.ts`, `_archive/count-dashboard-pins.ts`, etc.). `Unexpected any` and `prefer-const` errors mostly.
- **Why it matters**: Same root cause as F1, F2 — GitHub Actions CI is failing for several commits in a row. CLAUDE.md doesn't have an `.eslintignore` strategy for `_archive` paths.
- **Recommended fix**: One of:
  - Add `eslintConfig.ignorePatterns: ["scripts/_*.ts", "scripts/_archive/**"]` so these files don't lint. ~2 min.
  - Or fix the 16 errors. ~1 hour.
  - Or move `_archive/*` to a separate package outside the eslint root. ~30 min.

**F4** | **HEALTHY (carry-forward closed)** | `.github/workflows/ci.yml:50` — domain placeholder
- **04-29 finding**: `NEXT_PUBLIC_APP_URL: https://henri.app` placeholder — cosmetic but stale post-domain-swap.
- **Today**: Line 50 reads `NEXT_PUBLIC_APP_URL: https://meethenri.com`. ✓ Closed.

**F5** | **HEALTHY** | `vercel.json` — 20 crons configured
- See [06-performance.md](./06-performance.md) for the full schedule.
- One slot collision flagged at 14:00 UTC (P2).

**F6** | **HEALTHY** | `package.json` dependencies
- Next 16.2.3 / React 19.2.4 / Tailwind 4 / Vitest 4.1.4 / Sentry 10.50.0 / Stripe 22 / Twilio 5.13.1 / Resend 6.11.0 / Supabase-js 2.103 / OpenAI 6.34 / MapLibre 5.23 / pmtiles 4.4 / Recharts 3.8.
- 17 dependency entries. All reasonable for Henri's surface area.

**F7** | **HEALTHY** | Build is green outside lint
- `pnpm tsc --noEmit` exit 0.
- `pnpm vitest run` 428/428.
- `pnpm truthfulness` PASS.

## CI workflow steps (`.github/workflows/ci.yml`)

```yaml
1. Checkout (actions/checkout@v4)
2. Setup pnpm 9 (pnpm/action-setup@v3)
3. Setup Node 20 (actions/setup-node@v4)
4. pnpm install --frozen-lockfile
5. pnpm lint --max-warnings=0       ← FAILING (F1, F2, F3)
6. pnpm tsc --noEmit                 ← PASS
7. pnpm truthfulness                 ← PASS
8. pnpm test                         ← PASS
9. pnpm build                        ← PASS
10. e2e job (separate) — Playwright with placeholder env
```

## Production deploy status

Production is serving `1437f86` at `https://meethenri.com`:
- HTTP 200
- Server: Vercel
- Full security-header set (CSP / HSTS / X-Frame / X-Content-Type / Referrer / Permissions / X-DNS-Prefetch).
- Live verified the homeowner intake skip-zip + back-nav fix at 07:37 UTC.

**Note**: Vercel runs its own build pipeline (independent of GitHub Actions CI). The GitHub Actions failure on `lint` does NOT block Vercel deploys; Vercel's build only runs `next build`. The two systems should ideally agree, but Vercel currently produces correct binaries even while GitHub Actions reports failure.

## Closing

Build + deploy is operational; the GitHub Actions lint failure is a hygiene issue (pre-existing for 3+ commits) that should be cleaned up so the CI green-checkmark is meaningful again. The two React 19 lint errors (F1 + F2) are real issues worth fixing on their own merits.
