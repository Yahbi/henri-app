# 06 — Performance

## TL;DR

Hot-path query patterns (paginated leads, signal breakdown, capacity filter) UNCHANGED. Bundle size stable; PDF renderer (`src/lib/pdf/proposal-renderer.tsx`) is server-side only. **REGRESSION**: Vercel Hobby plan capped daily-only crons forced all 17 crons to a daily slot. Score-cron (every 2h yesterday) now runs at 01:00 UTC — a permit filed at 06:00 has 19 hours of scoring latency, which violates wedge bullet #5 (speed-to-lead). Acceptable for a 1-week launch window if the Pro upgrade is on the calendar; not acceptable as a steady state.

## Score

**WATCH** — REGRESSED vs 2026-04-28 (was HEALTHY).

## Findings

### F1. WATCH — Cron cadence downgrade violates wedge bullet #5
**File**: `vercel.json`
**Severity**: High (operational, time-bounded)
**Why it matters**: Worst-case latencies under daily-only crons:

| Cron | Was | Now (daily) | Worst-case latency | Wedge impact |
|---|---|---|---:|---|
| `/api/cron/score` | `1 */2 * * *` (every 2h) | `0 1 * * *` | 23h | Wedge #5 (speed-to-lead) violated |
| `/api/cron/scrape` | `5,35 * * * *` (every 30 min) | `0 2 * * *` | 24h | New permits land 24h late |
| `/api/cron/enrich` | `5,20,35,50 * * * *` (every 15 min) | `0 13 * * *` | 24h | Contact info lags 24h |
| `/api/cron/follow-ups` | `0,15,30,45 * * * *` (every 15 min) | `0 11 * * *` | 24h | Follow-up timing skewed |
| `/api/cron/permits` | `20 */6 * * *` (every 6h) | `0 12 * * *` | 24h | Permit sync lags 24h |
| Others | varied | daily | 24h | Lower priority — acceptable |

Score-cron is the most painful: a contractor who logs in at 09:00 sees yesterday's permits but no scores until 01:00 UTC the next day.

**Recommended fix**: Schedule the Vercel Pro upgrade for the end of week 1. On upgrade, edit `vercel.json` to restore the prior cadences (commit `4b7565b`'s parent has the old values). ~5 min edit + redeploy.
**Delta tag**: REGRESSED.

### F2. HEALTHY — `useLeads` query pattern stable
**File**: `src/hooks/useLeads.ts`
**Severity**: Low (positive finding)
**Why it matters**: Wide → narrow fallback (extendedColumnsMissing flag at lines 145–179) still in place. Multi-page dedup via `Map<id, row>` (lines 242–248) intact. Now backed by `useLeads.helpers.test.ts` (28 tests) covering both paths and the god-mode bypass.
**Recommended fix**: None. Optional: add a server-side projection helper that the hook can call to push the wide vs narrow decision into Supabase RPC; currently both branches share client-side post-filter.
**Delta tag**: UNCHANGED.

### F3. HEALTHY — PDF renderer is server-side only
**File**: `src/lib/pdf/proposal-renderer.tsx`
**Severity**: Low (positive finding)
**Why it matters**: pdfkit-based; called from `/api/estimates/[id]/pdf/route.ts` which is a server route. The renderer's React-flavored `.tsx` is JSX-as-DSL for layout but compiles into a server-only module. No bundle impact on the dashboard JS.
**Recommended fix**: None.
**Delta tag**: NEW (the file itself is new since last audit) but UNCHANGED-pattern.

### F4. HEALTHY — Cron orchestrator deadline + rate-limit discipline intact
**Severity**: Low (positive finding)
**Why it matters**: Each cron route caps `maxDuration=300` with an internal soft-deadline check at ~280s. Polite vendor rate-limits (1/s for Nominatim, 5/s for Regrid, etc.) preserved. Per-source telemetry counters (D3 fix from prior session) emit into the structured logger.
**Recommended fix**: Yesterday's audit's #8 ("inline 280s deadline check on score + permits crons") still applies. The current daily cadence makes a 280s timeout less likely to hit in the score-cron, but the check belongs there for safety. ~30 min.
**Delta tag**: UNCHANGED.

### F5. HEALTHY — Map page lazy-loads heavy components
**File**: `src/app/(dashboard)/dashboard/map/page.tsx` and friends
**Severity**: Low (positive finding)
**Why it matters**: MapLibre GL, FEMA flood layer, NOAA radar layer, census layer all loaded via `next/dynamic`. Initial dashboard page bundle stays lean.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F6. WATCH — Rate limiting on hot routes still missing
**Severity**: Medium
**Why it matters**: 2026-04-28 audit flagged that `/api/intake`, `/api/billing/change-plan`, `/api/dev/switch-role` lack per-IP / per-user rate limits. Status today: still missing. Not exploited but a Stripe coupon-spamming or CSV-stuffing attack could pile up writes.
**Recommended fix**: Add a simple in-memory or KV-backed rate limiter as a route helper. Pattern: 30 requests/min/IP for public routes, 5 requests/min/IP for state-mutating routes. ~2 hours.
**Delta tag**: UNCHANGED.

## Verdict

Performance is WATCH today purely because of F1. The other findings are healthy or are the same WATCH-level item from yesterday (F6 rate limits). Once Pro-plan upgrade lands and `vercel.json` is reverted, this returns to HEALTHY immediately.
