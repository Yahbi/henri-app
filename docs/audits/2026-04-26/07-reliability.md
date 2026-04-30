# 07 — Reliability

## TL;DR

Reliability is a strength. Every route segment has an `error.tsx`, the feature-flag-before-migration pattern is consistently applied (graceful-degrade on missing tables/columns), the cron orchestrator uses deadline enforcement and per-item try/catch so single-permit failures don't kill the batch. The single concern: **test coverage is thin** (7 test files for 68k LOC) — see [09-tests.md](./09-tests.md). Reliability patterns hold today; they'd survive longer with regression tests.

## Score

**HEALTHY** — graceful-degrade culture is real, just untested.

## Findings

### F1 — Every route segment has an `error.tsx`

- **Severity**: Nitpick (positive)
- **File**: `src/app/error.tsx`, `src/app/(auth)/error.tsx`, `src/app/(marketing)/error.tsx`, `src/app/(homeowner)/error.tsx`, `src/app/onboarding/error.tsx`, plus per-segment in `(dashboard)/dashboard/*/error.tsx`
- **Why it matters**: Per reliability-agent: full hierarchical coverage. An unhandled render error never produces the Next.js grey screen — it produces a branded retry page with a digest reference. This is hard to set up correctly and worth keeping.
- **Recommendation**: None. When adding a new route segment, copy the `error.tsx` from a sibling — don't introduce a no-error-boundary segment.

### F2 — Feature-flag-before-migration pattern reference implementations

- **Severity**: Nitpick (positive)
- **File**: `src/app/api/feedback/route.ts`, `src/app/api/exclusivity/route.ts`, `src/hooks/useLeads.ts`
- **Why it matters**: Per `CLAUDE.md`: "Every new DB column/table ships with a graceful-degrade fallback so the UI keeps rendering before the SQL lands." Three references:
  1. `/api/feedback`: triple-fallback. DB insert is best-effort (table-missing → log warn + continue), email is best-effort (Resend failure → continue), JSONL local file is the final sink. Returns 200 if any succeed, 502 only if all fail.
  2. `/api/exclusivity`: when `lead_exclusivity_locks` table is missing, returns empty summary `{}` so the dashboard renders zero badges instead of crashing.
  3. `useLeads`: wide/narrow SELECT retry-fallback. On column-not-exists, caches the verdict for the session and retries with the legacy column list.
- **Recommendation**: None. These three are the canonical examples for any future migration that adds a column/table.

### F3 — Cron `/api/cron/enrich` has deadline enforcement and per-item failure isolation

- **Severity**: Nitpick (positive)
- **File**: `src/app/api/cron/enrich/route.ts`
- **Why it matters**: Per reliability-agent:
  - 280s deadline buffer vs 300s `maxDuration` — exits cleanly before Vercel kills the function.
  - Per-lead try/catch — a single failing enrichment increments a counter and continues; doesn't abort the batch.
  - Work-stealing queue across 4 workers — slow county GIS endpoints don't idle the others.
  - 500ms per-worker rate-limit — polite to free public GIS servers.
  - Self-advancing filter (`year_built IS NULL` without ORDER BY) — exits at BATCH_SIZE match, never full-table scan.
- **Recommendation**: None. When 00043's indexes land, the same filter will run dramatically faster, but the safety mechanisms still protect against partial failures.

### F4 — `/api/messages/send` graceful provider degradation

- **Severity**: Nitpick (positive)
- **File**: `src/app/api/messages/send/route.ts`
- **Why it matters**: Per reliability-agent: if Twilio (SMS) and Resend (email) both fail, the route logs the message intent to the lead's notes table and returns `ok=false`. The caller sees the failure but the user-facing record of "we tried" persists. No silent loss.
- **Recommendation**: None. This is the canonical "vendor-down" handling pattern — extend to other vendor calls (e.g., Stripe portal session creation) when relevant.

### F5 — `useLeads` partial-result tolerance

- **Severity**: Nitpick (positive)
- **File**: `src/hooks/useLeads.ts:165-173`
- **Why it matters**: When fetching god-mode 5k+ leads, page N can hit a Supabase statement timeout. Instead of throwing (which would empty the dashboard), `useLeads` logs a `console.warn` and returns the rows collected so far. The user sees 4k of 5k leads, not zero.
- **Recommendation**: None. Surface the partial-result count to the UI so the user knows the list is truncated (currently silent except for the console).

### F6 — `WRITE_PROVENANCE` and `WRITE_EXTENDED` env gates are correctly used

- **Severity**: Low
- **File**: `src/app/api/cron/enrich/route.ts`, `src/app/api/feedback/route.ts`
- **Why it matters**: These flags let new write paths land BEFORE the migration without crashing. After the migration applies, the flag flips to `1` and writes resume.
- **Recommendation**: See [02-data-layer.md F8](./02-data-layer.md#f8--cron-route-reads-enrichment-columns-via-raw-select-but-writes-via-env-gated-branch) — rename or comment the precondition more loudly.

### F7 — No global retry/backoff strategy for vendor calls

- **Severity**: Medium
- **File**: `src/lib/openai/scorer.ts`, `src/lib/twilio/sms.ts`, `src/lib/resend/email.ts`, county GIS callers
- **Why it matters**: Each vendor call appears to be try-once-or-fail. OpenAI rate-limits with 429, Twilio occasionally 5xxs on internal hiccups, county GIS endpoints throttle aggressively. Without retry+backoff, transient failures become permanent.
- **Recommendation**: Add a `withRetry()` helper in `src/lib/utils/retry.ts`:
  ```ts
  export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: { attempts?: number; backoffMs?: number; retryOn?: (err: unknown) => boolean } = {}
  ): Promise<T> { /* exponential backoff, jitter, capped attempts */ }
  ```
  Wrap the high-failure vendor calls. Don't wrap the cron's per-permit enrichment — that already has per-item isolation.

### F8 — Idempotency on Twilio / Resend webhooks not confirmed

- **Severity**: Medium
- **File**: `src/app/api/webhooks/twilio/route.ts`, `src/app/api/webhooks/twilio-missed-call/route.ts`, `src/app/api/webhooks/resend/route.ts`
- **Why it matters**: Stripe is verified-idempotent (per [05-security.md F11](./05-security.md)). Twilio and Resend retry webhooks on any non-2xx response, so a slow handler can receive duplicate deliveries. If the handler does `INSERT INTO sms_log (...)` without a unique constraint, duplicates corrupt the audit trail.
- **Recommendation**: Confirm each webhook either (a) has a natural unique key (Twilio `MessageSid`, Resend `id`), or (b) uses `INSERT ... ON CONFLICT DO NOTHING`. Document the idempotency strategy in a top-of-file comment per webhook.

### F9 — Toast-driven success / failure UX is consistent

- **Severity**: Nitpick (positive)
- **File**: `src/components/ui/toast.tsx`, consumed by mutation hooks
- **Why it matters**: The Toast primitive supports `success` / `error` / `warning` / `info` types with `aria-live="polite"`. Mutation hooks (e.g., `useUpdateLeadStatus`) wire success / error toasts. Users always get feedback on async actions.
- **Recommendation**: None. Document in `12-documentation.md` as the canonical "user feedback after mutation" pattern.

### F10 — No alerting on cron failures

- **Severity**: Medium
- **File**: `vercel.json`, no observability config
- **Why it matters**: Cron routes log errors via the structured logger, which prints to Vercel logs. But there's no automated alert if `/api/cron/enrich` returns 500 three runs in a row. The user finds out when they happen to look at the logs.
- **Recommendation**: After the Sentry sink lands (`logger.ts` already has the scaffold), Sentry's per-route alerting catches this for free. Until then, consider a daily `/api/cron/health-check` that pings each cron route and emails a summary if any are failing.

### F11 — Stripe webhook event handling: only specific event types matter

- **Severity**: Low
- **File**: `src/app/api/webhooks/stripe/route.ts`
- **Why it matters**: Stripe sends ~200 event types; Henri likely only cares about `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.{paid,payment_failed}`. If the handler has a default case that 200s on unknown events, that's fine. If it 500s, Stripe will retry the unknown event up to 3 days, hammering the endpoint.
- **Recommendation**: Confirm the handler's default case. If unknown events trigger the catch block, change to silent 200.

## What's working well

- **Error boundaries everywhere** (every route segment has `error.tsx`).
- **Feature-flag-before-migration pattern is real** — three reference implementations.
- **Cron orchestrator is fault-tolerant**: deadline enforcement, per-item try/catch, work-stealing queue, polite vendor rate-limits.
- **Toast feedback** on every mutation.
- **Vendor degradation paths** documented (`/api/messages/send`).
- **Partial-result tolerance** in `useLeads` for large fetches.
