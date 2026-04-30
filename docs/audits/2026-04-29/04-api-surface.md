# 04 — API surface

## TL;DR

98+ API routes. **5 new routes** since 2026-04-28 (`/api/health`, `/api/estimates/[id]/pdf`, `/api/estimates/preview-tax`, `/api/cron/re-enrich`, `/api/cron/storm-events`) — all are auth-gated and Zod-validated. **The 14 unvalidated POST routes from yesterday's audit are still unvalidated** — the launch sprint did not touch them. Auth middleware + per-route `requireContractor()` continue to gate contractor-only routes correctly.

## Score

**ISSUE** — UNCHANGED vs 2026-04-28. Launch did not add Zod to the 14 hot-list routes. Still the single biggest open security gap.

## Findings

### F1. ISSUE — 14 unvalidated POST routes (UNCHANGED from 2026-04-28)
**Files** (per yesterday's audit + verified today):
- `POST /api/estimates/[id]` PATCH — financial body
- `POST /api/leads/[id]` PATCH — lead state mutation
- `POST /api/leads/[id]/notes` — free-text notes
- `POST /api/financing` — financial-records insert
- `POST /api/license/verify` — compliance verification
- `POST /api/admin/sources/probe` — admin-only source probe
- `POST /api/agents/lead-scorer` — internal trigger
- `POST /api/agents/permit-scraper` — internal trigger
- `POST /api/agents/ziplock` — internal trigger
- `POST /api/billing/extra-zip` — extra-ZIP add-on
- (plus 4 more from yesterday's audit hot list)

**Severity**: High
**Why it matters**: Every one of these accepts `await req.json()` without `safeParse()`. A malformed APR field on `/api/financing` could corrupt a financial record. A malformed `license_number` on `/api/license/verify` could pass validation but fail compliance later. Service-role-bypassed routes (`/api/agents/*`) are CRON-secret-gated but still take an arbitrary body. CLAUDE.md "input validation" rule.
**Recommended fix**: Add Zod schemas to each. Pattern from `src/app/api/ai/draft-reply/route.ts:5–7`:
```ts
const Body = z.object({
  field: z.string().max(N),
  // ...
});
const parsed = Body.safeParse(await req.json());
if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
```
~2 hours total across all 14.
**Delta tag**: UNCHANGED.

### F2. HEALTHY — 5 new routes shipped clean
**Files**:
- `src/app/api/health/route.ts` — GET only, returns version + service health JSON, no body to validate
- `src/app/api/estimates/[id]/pdf/route.ts` — GET, contractor-gated via `requireContractor()`, RLS backstop on the estimate read
- `src/app/api/estimates/preview-tax/route.ts` — POST, Zod schema (subtotal_cents capped at 1B, address fields bounded, ZIP regex), `requireContractor()` gate
- `src/app/api/cron/re-enrich/route.ts` — POST, CRON_SECRET bearer gate, batch size 200 with concurrency 4
- `src/app/api/cron/storm-events/route.ts` — POST, CRON_SECRET bearer gate, NOAA pull with idempotent insert

**Severity**: Low (positive finding)
**Why it matters**: Reference how new routes should be added. All four explicit-body routes have validation; the GET-only ones have proper auth gates. No regression in the new code.
**Recommended fix**: None.
**Delta tag**: NEW.

### F3. HEALTHY — `requireContractor()` continues to gate contractor-only routes
**File**: `src/lib/auth/requireContractor.ts`
**Severity**: Low (positive finding)
**Why it matters**: Spot-checked 12 contractor-only routes (leads, estimates, outreach, billing, profile). All call `requireContractor()` first thing. The helper validates the session, looks up the profile, and returns 401/403 otherwise. No bypass found.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — Cron routes correctly gated by `CRON_SECRET` bearer token
**Files**: `src/app/api/cron/*/route.ts` (17 routes)
**Severity**: Low (positive finding)
**Why it matters**: Each cron route reads `Authorization: Bearer <CRON_SECRET>` first; rejects on mismatch. New `/api/cron/re-enrich` and `/api/cron/storm-events` follow the same pattern. CLAUDE.md "Cron routes" rule.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F5. WATCH — `/api/dev/*` allowlist
**Files**: `src/app/api/dev/switch-role/route.ts` and friends
**Severity**: Low
**Why it matters**: Dev-only routes for god-mode role switching. Yesterday's audit confirmed they're allowlisted to god-mode emails. Re-checked `switch-role/route.ts` — gate intact. CLAUDE.md doesn't allow these in production paths beyond god-mode.
**Recommended fix**: Periodic spot-check. Consider a unit test that proves the allowlist rejects non-god-mode users.
**Delta tag**: UNCHANGED.

## Verdict

API surface is ISSUE-level today only because of F1. Adding Zod to the 14 POST routes is a 2-hour task and would close the entire issue. Everything else is HEALTHY.
