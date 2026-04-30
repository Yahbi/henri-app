# 06 — Performance (2026-04-30)

## TL;DR

Enrichment cron throttle bumped 8× today (BATCH_SIZE 600→1200, CONCURRENCY 4→6, 4 daily slots). Capacity is now ~4,800 leads/day; 165k stale-lead backlog clears in ~35 days. **Cron-slot collision at 14:00 UTC** between enrich and geocode-backfill — surfaced today as a side-effect of the slot expansion. RLS initplan WARN (54 instances) remains the single largest perf overhead.

## Score

**WATCH** — IMPROVED on enrichment throughput, REGRESSED on cron slot scheduling.

## Findings

**P1** | **GREEN — improved** | Enrichment cron throughput (`src/app/api/cron/enrich/route.ts`)
- **04-29 state**: BATCH_SIZE=600, CONCURRENCY=4, single 13:00 UTC slot. Math: 600 leads / 8 req/s = 75s typical. ~600 leads/day. 165k backlog clears in ~275 days.
- **04-30 commit `1437f86`**: BATCH_SIZE=1200, CONCURRENCY=6, slots at 13:00 / 13:15 / 14:00 / 14:15 UTC. Math: 1200 leads / 12 req/s = 100s typical, 240s worst. ~4,800 leads/day. 165k backlog clears in ~35 days.
- **Inside the 300s maxDuration + Supabase 100-pool**: 6 concurrent connections + initial SELECT = 7 connections total. Comfortable headroom.
- **Status**: ✓ Improved.

**P2** | **High** | `vercel.json:53,65` — cron-slot collision at 14:00 UTC
- **Issue**: `/api/cron/enrich` and `/api/cron/geocode-backfill` both fire at `0 14 * * *`.
- **Why it matters**: Enrich now does 1200 leads / 100s typical / 240s worst at this slot. Geocode-backfill is geocoding-bound. Concurrent runs can pressure the Supabase connection pool and county GIS endpoints.
- **Recommended fix**: In `vercel.json`, change `geocode-backfill` to `30 14 * * *` (14:30 UTC, 30 min after the enrich batch completes). 1-line change.

**P3** | **High** | Supabase advisor: 54 RLS initplan WARN + 21 multiple-permissive policy WARN
- **Issue**: Same as 04-29. Each `auth.uid()` call inside an RLS policy is re-evaluated per row when the policy uses `auth.uid()` directly instead of `(SELECT auth.uid())`.
- **Why it matters**: At 1000 leads × 1 dashboard fetch × 10 contractors, this multiplies the auth-call cost by row count. Wedge bullet #5 (speed-to-lead) wants <100ms drawer renders.
- **Recommended fix**: Migration `00061_rls_initplan_perf_pass.sql`. ~1-2 hours focused work. See [02-data-layer.md F1](./02-data-layer.md).

**P4** | **HEALTHY** | Cron deadline enforcement
All CPU-intensive cron routes implement explicit `deadline = t0 + 280_000` checks (20s headroom from `maxDuration = 300`):
- `enrich/route.ts:160` (today) — verified
- `score/route.ts:136` — verified
- `re-enrich/route.ts:138` — verified
- `permits/route.ts:83` — verified

Worker loops poll `if (Date.now() > deadline) return;` and exit cleanly without dropping work.

**P5** | **HEALTHY** | `useLeads` retry-fallback (`src/hooks/useLeads.ts:37-39, 93`)
Module-scoped `extendedColumnsMissing` flag. First fetch tries `SELECT_WIDE` (includes new columns). On "column does not exist" error, flag is set and subsequent fetches use `SELECT_NARROW`. Single probe per page load. Migration 00039/00044 backfill is transparent.

**P6** | **HEALTHY** | Bundle bloat / wildcard imports
14 `import * as` matches in the codebase; all are utility/standard-library imports (React, fs, type bundles). No heavy third-party tree-shake blockers. `LeadDetailDrawer.tsx` cherry-picks lucide-react icons individually.

**P7** | **Low** | `src/app/(dashboard)/dashboard/map/page.tsx` (828 LOC)
- **Issue**: Map dashboard is monolithic; 10 overlay layers + state machine + zoom logic in one file. Each overlay loads on toggle, but their import graph is shared.
- **Why it matters**: Hard to lazy-split overlay code paths; tree-shaker can't optimize per-overlay payload.
- **Recommended fix**: Extract each overlay to a dynamic-import boundary. Backlog Q3.

## Cron schedule audit (post 04-30 expansion)

| Time (UTC) | Cron | Notes |
|---|---|---|
| 01:00 | score | |
| 02:00 | scrape | |
| 03:00 | engagement | |
| 03:30 | re-enrich | |
| 04:00 | zip-demand | |
| 04:30 | market-intel | |
| 05:00 | billing-sync | |
| 06:00 | license-check | |
| 07:00 | digest | |
| 08:00 (Mon) | weekly-digest | |
| 09:00 | storm-events | |
| 10:00 | review-requests | |
| 11:00 | follow-ups | |
| 12:00 | permits | |
| **13:00** | enrich | NEW slot (was the only one before today) |
| **13:15** | enrich | NEW (today) |
| **14:00** | enrich + geocode-backfill | **COLLISION (P2)** |
| **14:15** | enrich | NEW (today) |
| 15:00 | blast-worker | |

20 total scheduled invocations (was 17).

## Closing

Today's enrichment throughput bump is the right tradeoff between speed-to-coverage and platform load. The single new operational risk is the 14:00 UTC slot collision (P2), which is a 1-minute fix. The biggest unaddressed perf item is the RLS initplan rewrite (P3), which has been on the backlog since 04-26.
