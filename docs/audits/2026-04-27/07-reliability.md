# 07 — Reliability

## TL;DR

Reliability patterns are unchanged from baseline: feature-flag-before-migration is consistent, every route has `error.tsx`, cron uses deadline + per-item try/catch. The new `/api/cron/re-enrich` follows the same pattern (verified live with the migration-pending graceful-degrade). The remaining gaps are baseline-tier: Twilio + Resend webhook idempotency unverified; no retry/backoff for OpenAI/county-GIS rate-limits; no Sentry alert rules (waiting on `SENTRY_DSN`).

## Score

**HEALTHY** — graceful-degrade culture sustained; thin coverage on vendor retry paths.

## Findings

### F1 — Every route segment has `error.tsx` (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: Hierarchical error boundaries at every level.

### F2 — Feature-flag-before-migration: 4 reference implementations (RECONFIRMED)

- **Severity**: HEALTHY
- **Examples**:
  - `/api/feedback`: DB best-effort → email best-effort → local JSONL sink
  - `/api/exclusivity`: empty-summary on missing table
  - `useLeads`: column-fallback retry on missing column
  - `/api/cron/re-enrich`: `{skipped_migration_pending:true}` on missing column (NEW 2026-04-26)
- **Status**: Pattern is canon.

### F3 — Cron `/api/cron/enrich` deadline + per-item failure isolation (RECONFIRMED)

- **Severity**: HEALTHY
- **Pattern**: 280s deadline, per-lead try/catch, self-advancing filter (`year_built IS NULL`).

### F4 — Orchestrator telemetry hooks (positive)

- **Severity**: HEALTHY
- **File**: `src/lib/enrichment/orchestrator.ts:276-310`
- **What it does**: Per-source counters (`calls`, `hits`, `totalLatencyMs`); `getTelemetry()` exposed; cron logs hit-rate per source at end of batch.

### F5 — `/api/cron/re-enrich` graceful-degrade verified live (NEW 2026-04-26)

- **Severity**: HEALTHY
- **File**: `src/app/api/cron/re-enrich/route.ts:117-126`
- **Verified**: Live curl returned `{success:true, skipped_migration_pending:true, elapsedMs:154}` because 00051 isn't applied. Once applied, the cron will start chewing stale leads.

### F6 — Stripe webhook idempotency (RECONFIRMED)

- **Severity**: HEALTHY
- **File**: `src/app/api/webhooks/stripe/route.ts:66-82`
- **Status**: Unique constraint on `billing_events.stripe_event_id`.

### F7 — Twilio + Resend webhook idempotency NOT verified (UNCHANGED)

- **Severity**: MEDIUM
- **Files**: `src/app/api/webhooks/{twilio, twilio-missed-call, resend}/route.ts`
- **Recommendation**: Manual verification — are `MessageSid`/Resend `id` used as natural keys with `INSERT ... ON CONFLICT DO NOTHING`? Document the strategy in a top-of-file comment.

### F8 — No global retry/backoff for vendor calls (UNCHANGED)

- **Severity**: MEDIUM
- **Files**: `src/lib/openai/scorer.ts`, `src/lib/twilio/sms.ts`, `src/lib/resend/email.ts`
- **Recommendation**: Author `src/lib/utils/retry.ts` with exponential backoff + jitter; wire to high-failure callers (skip cron per-item enrich, which already has isolation).

### F9 — Toast-driven UX (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: Toast primitive with `aria-live="polite"`; mutation responses surfaced.

### F10 — No alerting on cron failures (UNCHANGED)

- **Severity**: MEDIUM
- **Status**: Cron logs structured errors but no automated alert on consecutive 500s.
- **Recommendation**: After `SENTRY_DSN` is set, configure Sentry alert rules: "500 errors on `/api/cron/*` in prod → email".

### F11 — `import-permit-archive.ts` background script (procedural)

- **Severity**: LOW
- **Status**: One-off bulk loader; resumable via `.import-state.json`. No alert if it crashes mid-run; operator notices via missing progress logs.
- **Recommendation**: Acceptable for one-off; not worth an alert wiring.

## Recommendations summary

| # | Action | Effort | Blocker |
|---|---|---|---|
| F7 | Verify Twilio/Resend webhook idempotency, document | 1 h | No |
| F8 | Author `src/lib/utils/retry.ts`, wire to vendors | 2 h | No |
| F10 | Wire Sentry alert rules after DSN set | 30 min | No |
