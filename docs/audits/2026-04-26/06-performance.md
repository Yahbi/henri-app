# 06 — Performance

## TL;DR

Performance is in good shape. The most fragile path (`useLeads` paginating up to 5,000 leads) is correctly bounded by Supabase's 1000-row cap with `.range()` pagination + stable tiebreaker + defensive dedupe. Heavy libs (`maplibre-gl`, `recharts`) are lazy-loaded; server-only deps (`openai`, `twilio`, `stripe`) never reach the browser bundle. Two pressing items: **(1)** the burst-enrich cron is hitting Supabase statement timeouts because partial indexes (migration 00043) aren't applied yet — see [02-data-layer.md F1](./02-data-layer.md); **(2)** several hot routes (`/api/leads/map`, `/api/leads/count`, `/api/intelligence`) lack rate limits — see [04-api-surface.md F6](./04-api-surface.md).

## Score

**HEALTHY** — query patterns sound, only the index gap is bottlenecking.

## Findings

### F1 — `useLeads` pagination + retry-fallback is exemplary

- **Severity**: Nitpick (positive)
- **File**: `src/hooks/useLeads.ts:121-186`
- **Why it matters**: This hook is the dashboard's busiest path. It correctly:
  - Paginates `.range(start, end)` when limit > 1000 (god-mode 5k+).
  - Rebuilds the query per page (Supabase builders are single-use after `.range()`).
  - Applies stable tiebreaker (`order("score", desc).order("id", asc)`) so equal-score rows don't shuffle between pages — fixes the React duplicate-key warning that surfaced as 220 errors per dashboard load before this fix.
  - Dedupes on `id` defensively, in case future view drift reintroduces overlap.
  - Has partial-result tolerance: if a later page hits the statement timeout, return the rows we have rather than throwing.
  - Uses module-scoped `extendedColumnsMissing` flag so the wide/narrow SELECT probe runs once per page-load, not per fetch.
- **Recommendation**: None. Reference this in `12-documentation.md` as the canonical "fetch large result set" pattern.

### F2 — Burst-enrich cron blocked on missing indexes (migration 00043)

- **Severity**: High
- **File**: `src/app/api/cron/enrich/route.ts`, `supabase/migrations/00043_enrich_indexes.sql`
- **Why it matters**: Per session notes: the burst-enrich filter `is("year_built", null).not("address", "is", null)` matches ~99% of 133k leads when `year_built IS NULL` is the dominant predicate. Without a partial index, Postgres does a full table scan and hits the statement timeout. Migration 00043 adds:
  - `leads_enrich_year_built_null_idx` (partial WHERE year_built IS NULL)
  - `leads_enrich_owner_null_idx`
  - `leads_enrich_phone_null_idx`
  - `leads_geocoded_idx`
  - `permits_address_zip_owner_idx` (composite for sibling lookup)
  - `permits_contractor_applicant_idx`
  Until applied, the cron is degraded.
- **Recommendation**: Apply `_pending-bundle.sql` to Supabase. After apply, monitor Vercel cron logs for the next 24h to confirm the timeout disappears.

### F3 — Lazy loading of heavy libs is correct

- **Severity**: Nitpick (positive)
- **File**: `src/components/map/MapDashboard.tsx`, `src/components/analytics/LeadTrendChart.tsx`
- **Why it matters**: Per perf-agent: `maplibre-gl` is loaded via dynamic `await import(...)` in map components, never as a top-level static import. `recharts` is only imported in `LeadTrendChart.tsx` (analytics surface). `next/dynamic({ ssr: false })` is used for `MapDashboard` — the entire map module is split out of the dashboard bundle for users who never visit `/dashboard/map`.
- **Recommendation**: None. `next-bundle-analyzer` is in `devDependencies` (per package.json: `@next/bundle-analyzer`) — run `pnpm build:analyze` once per quarter and fix any regressions.

### F4 — Server-only SDK deps never reach the browser

- **Severity**: Nitpick (positive)
- **File**: `package.json` deps: `openai`, `twilio`, `stripe`, `@supabase/admin`
- **Why it matters**: Per perf-agent: no client component imports `openai`, `twilio`, or `stripe` at the top level. All vendor calls are server-side via API routes. This is critical — the OpenAI SDK alone is ~2MB minified.
- **Recommendation**: None. Add a CI check that fails if `'openai'`, `'twilio'`, `'stripe'`, or `'@supabase/.../admin'` appears in any `'use client'` file.

### F5 — `permits` join is single round-trip, not n+1

- **Severity**: Nitpick (positive)
- **File**: `src/hooks/useLeads.ts:39-49`
- **Why it matters**: PostgREST nested-resource embedding (`select: "...permits(...)"`) compiles to a single SQL query with a JOIN, not N+1 fetches. The audit confirms `useLeads` uses this idiom and `latitude`/`longitude` are denormalized to the lead row to avoid the not-null filter on the joined table (which can't use the permits index — would trigger a statement timeout on large datasets, per the comment in the hook itself).
- **Recommendation**: None. The denormalization comment in the hook is excellent — preserve it during refactor.

### F6 — Hot routes missing rate limits

- **Severity**: Medium
- **Files**: `src/app/api/leads/map/route.ts`, `src/app/api/leads/count/route.ts`, `src/app/api/intelligence/route.ts`, `src/app/api/storm/route.ts`
- **Why it matters**: See [04-api-surface.md F6](./04-api-surface.md). These are computationally expensive (GeoJSON shaping, aggregation queries) and unauth'd request bursts could degrade the DB.
- **Recommendation**: Wire `applyRateLimit()` from `src/lib/utils/rate-limit.ts`. 60 requests / minute / IP is reasonable for dashboard endpoints.

### F7 — `mapLead` runs on every fetch even when leads cache is warm

- **Severity**: Low
- **File**: `src/app/(dashboard)/dashboard/page.tsx:54-130`
- **Why it matters**: `mapLead` is called inside the `leads.map()` for every fetched row to transform `Lead` → `LeadData`. Each call does ~25 field reads with chained `as unknown as` casts. For a 5k-lead god-mode load, that's 125k cast operations on every refetch, even if the underlying data is identical. React Query's `staleTime: 60_000` reduces refetch frequency, but the work still runs on each invalidation.
- **Recommendation**: After `useLeads` returns, memoize the `mapLead`-applied array in the consumer:
  ```ts
  const leadCards = useMemo(() => leads.map(mapLead), [leads]);
  ```
  Single-line. Reference equality on `leads` means the memo only recomputes on actual data change.

### F8 — Bundle size baseline not measured

- **Severity**: Low
- **File**: N/A — no baseline doc
- **Why it matters**: `pnpm build:analyze` produces a report but there's no checked-in baseline saying "homepage is 180KB gzipped, dashboard is 420KB". Without a baseline, regressions slip in unnoticed.
- **Recommendation**: After the next `pnpm build:analyze`, capture `docs/perf/bundle-baseline-2026-04-26.md` with per-route sizes. Re-measure quarterly.

### F9 — Next.js 16 Turbopack used in dev; `next build` uses webpack

- **Severity**: Low
- **File**: `package.json`, `AGENTS.md`
- **Why it matters**: Turbopack is faster but still maturing. Differences between the dev (Turbopack) and prod (webpack) builds occasionally surface — for example, the corrupt `.next/dev/types/routes.d.ts` we saw earlier in this session was a Turbopack hiccup. AGENTS.md correctly warns about Next.js 16's breaking changes; it should also note the dev/prod build engine split.
- **Recommendation**: Add to AGENTS.md: "Dev uses Turbopack, prod build uses webpack. If a build error appears only in `next build` (not `next dev`), it's a webpack-specific resolution issue."

### F10 — No CDN cache headers on overlay routes

- **Severity**: Low
- **File**: `src/app/api/overlays/{fema,census,nws,weather,spc,permits}/route.ts`
- **Why it matters**: These routes return GeoJSON data that doesn't change every minute. FEMA flood data updates monthly. Census data updates yearly. SPC outlook updates 4x/day. Without `Cache-Control` headers, every page load re-fetches.
- **Recommendation**: Add `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` to the overlays response. Tune per-overlay (FEMA can be longer, NWS alerts shorter).

## What's working well

- **`useLeads` is the canonical query pattern** — paginated, deduped, fault-tolerant, retry-on-missing-column.
- **Heavy libs lazy-loaded** (maplibre, recharts).
- **Server-only SDKs never reach client bundle** (openai, twilio, stripe).
- **No n+1 query patterns** observed.
- **Denormalization where it counts**: `leads.latitude/longitude` instead of joined-permit lat/lng for the geocoded filter.
- **Cron deadline enforcement** (`/cron/enrich` 280s buffer vs 300s max).
- **React Query `staleTime: 60_000`** prevents over-refetching.
