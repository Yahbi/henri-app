# 07 — Reliability

## TL;DR

Error boundaries cover every route segment (26 `error.tsx` files). Graceful-degrade pattern is canonical (3 reference implementations, 9+ importer scripts now respect it). Stripe webhook idempotency confirmed. The two open items: **Twilio + Resend webhooks lack idempotency keys** and **2 cron routes lack inline deadline enforcement**.

## Score

**WATCH** — fixable in ~3 hours of focused work.

## Findings

### F1. HEALTHY — Error boundaries at every route segment
**Files**: 26 `error.tsx` files (per `find src -name error.tsx | wc -l`)
**Why it matters**: Next.js error boundaries catch render errors before grey-screen fallback. Every nested segment has one — `(dashboard)/error.tsx`, `(dashboard)/dashboard/error.tsx`, `(dashboard)/leads/[id]/error.tsx`, `(homeowner)/error.tsx`, `(auth)/error.tsx`, etc.
**Status**: No regressions.

### F2. ISSUE — Twilio + Resend webhooks lack idempotency keys
**Files**: `src/app/api/webhooks/twilio/route.ts:17-50`, `src/app/api/webhooks/resend/route.ts:15-50`
**Severity**: Medium-High
**Why it matters**: Both verify their respective signatures (Twilio `validateRequest()`, Resend Svix) and parse event IDs (`MessageSid`, `svix-id`) but neither checks them against a processed-events table. Replayed webhooks fire duplicate state updates / notifications. CLAUDE.md "idempotency on event ID" rule.

Stripe is the gold standard — see `src/app/api/webhooks/stripe/route.ts` for the canonical pattern (logBillingEvent + unique constraint on `stripe_event_id`).
**Recommended fix**: 
1. Migration: `CREATE TABLE IF NOT EXISTS webhook_idempotency (provider text, event_id text, processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (provider, event_id))`
2. In each webhook handler: check before processing, insert after.
3. ~1 hour each (2 hours total).

### F3. HEALTHY — Stripe webhook idempotency exemplary
**File**: `src/app/api/webhooks/stripe/route.ts`
**Why it matters**: Signature-verify-before-parse, idempotent on `event.id`, no client-controlled IDs from request body, B3 reorder fix (insert→coupon→update) shipped this session.
**Status**: Reference implementation.

### F4. WATCH — `/api/cron/score` + `/api/cron/permits` lack inline 280s deadline
**Files**: `src/app/api/cron/score/route.ts` (733 LOC), `src/app/api/cron/permits/route.ts` (per session B1 fix earlier)
**Severity**: Medium
**Why it matters**: Both have `maxDuration = 300` but no `Date.now() < deadline` check inside per-item loops. Vercel's 300s kill leaves partial state — half-scored leads, half-ingested permits. `/api/cron/enrich` is the reference (line 160).
**Recommended fix**: Add deadline check inline. ~30 min total.

### F5. HEALTHY — Graceful-degrade pattern canonical across 3 references + 9 importers
**Files**: `src/app/api/feedback/route.ts` (DB→email→JSONL), `src/app/api/exclusivity/route.ts` (table-missing→empty-summary), `src/hooks/useLeads.ts` (column-missing→narrow-SELECT), `scripts/import-*.ts` (PGRST204→strip-provenance)
**Why it matters**: CLAUDE.md "client-side fallback first" rule. New importer scripts this session (9 of them) all match the pattern.
**Status**: Healthier than at prior audit; pattern is universal.

### F6. HEALTHY — Cron orchestrator fault-tolerant
**File**: `src/app/api/cron/enrich/route.ts:159-285`
**Why it matters**: Work-stealing queue (workers pull from shared cursor), per-lead try/catch (line 275-284), deadline-enforcement (line 270), polite rate limit (line 252).
**Status**: Reference implementation; should be replicated in F4 routes.

### F7. WATCH — Importer scripts handle Supabase 522s but no resumable checkpoint on most
**Files**: `scripts/import-master-json.ts` (has checkpoint), `scripts/import-live-master.ts`, `scripts/import-dh3-*.ts`, `scripts/import-hd-*.ts` (no checkpoint)
**Severity**: Low
**Why it matters**: When Supabase's PostgREST is rate-limited (we hit this 3 times this session), the importer halves chunks and retries — but if it eventually gives up, re-running starts from offset 0. Idempotency on `source_key` makes re-runs safe (already-landed rows are no-ops), but redoing a 100k-row scan when only the last 5k failed is inefficient.

`import-master-json.ts` has the canonical checkpoint pattern: state file at `scripts/.import-master-json.state.json`, `cursor` saved per batch, `FRESH=1` env var to ignore.
**Recommended fix**: Extract checkpoint logic into shared helper `scripts/_import-checkpoint.ts`, use across all importers. ~1 hour.

### F8. HEALTHY — Vercel cron schedule is comprehensive
**File**: `vercel.json` (17 cron entries)
**Why it matters**: 17 scheduled jobs cover scoring (every 2h), scraping (every 30 min), enrich (every 15 min), re-enrich (daily 02:00), digest (daily 07:00), weekly digest (Mon 08:00), license check (daily 06:00), billing sync (every 6h), follow-ups (every 15 min), permits ingest (every 6h), review requests (daily 10:00), engagement (daily 03:00), zip-demand (daily 04:00), geocode-backfill (every 15 min), blast-worker (every 5 min), market-intel (daily 04:00), storm-events (daily 09:00).
**Status**: No action.

## Diff vs 2026-04-26

### Closed
- B3 (Stripe insert→coupon→update reorder) — was open prior
- D3 (per-source telemetry) — was open prior
- Graceful-degrade pattern extended to 9 importers (was open across just 3)

### Still open
- F2 (Twilio + Resend idempotency) — new finding
- F4 (deadline enforcement on score + permits crons) — partial close (enrich done; 2 remain)
- F7 (resumable checkpoints in importers) — new low-severity finding
