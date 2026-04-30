# 07 — Reliability

## TL;DR

New webhook idempotency module (`src/lib/webhooks/idempotency.ts`) wired into Twilio + Resend webhooks. Stripe webhook retains its exemplary `event.id` dedup pattern. Twilio missed-call route is the only remaining webhook not yet on the abstraction. Graceful-degrade patterns (table-missing, env-missing, vendor-down) verified across the stack. Error boundaries cover the dashboard and global error paths.

## Score

**HEALTHY** — IMPROVED vs 2026-04-28.

## Findings

### F1. HEALTHY — Webhook idempotency module wired (closes 2026-04-28 #7 priority)
**Files**:
- `src/lib/webhooks/idempotency.ts` (133 LOC) — provides `wasProcessed()` + `markProcessed()` with composite-key dedup
- `src/app/api/webhooks/twilio/route.ts` — uses key `${MessageSid}:${MessageStatus}` to dedup per status transition
- `src/app/api/webhooks/resend/route.ts` — uses `svix-id` header

**Severity**: Low (positive finding)
**Why it matters**: Twilio retries on 5xx or timeout; the same MessageSid/Status combo would fire duplicate handlers without dedup. Resend uses Svix delivery; same. The module logs a structured warn if migration `00054_webhook_idempotency.sql` is missing and falls through to pre-idempotency behavior — duplicates fire twice but the route doesn't crash. Mirrors the proven Stripe pattern.
**Recommended fix**: None. See F2 for the one webhook still on the legacy pattern.
**Delta tag**: IMPROVED (NEW since 2026-04-28).

### F2. WATCH — Twilio missed-call webhook not yet on the idempotency module
**File**: `src/app/api/webhooks/twilio-missed-call/route.ts`
**Severity**: Medium
**Why it matters**: This is the only webhook route in the codebase not using `wasProcessed()` / `markProcessed()`. Missed-call payloads from Twilio carry a unique `CallSid` per call event but Twilio still retries on 5xx, so duplicate "missed call" → text-back fires are possible. The existing route doesn't currently have its own dedup either.
**Recommended fix**: Copy the pattern from `twilio/route.ts`:
```ts
const idempotencyKey = `${callSid}:${callStatus}`;
const seen = await wasProcessed(supabase, "twilio", idempotencyKey);
if (seen) return NextResponse.json({ ok: true, skipped: "duplicate" });
// ... process ...
await markProcessed(supabase, "twilio", idempotencyKey, { event_type: callStatus });
```
~30 min including a small unit test.
**Delta tag**: UNCHANGED-OPEN.

### F3. HEALTHY — Stripe webhook retains exemplary pattern
**File**: `src/app/api/webhooks/stripe/route.ts`
**Severity**: Low (positive finding)
**Why it matters**: Signature verified before parse. `event.id`-based dedup using `billing_events` table. Referral-credit insert ordered before coupon creation (B3 fix). The new idempotency module wasn't retrofitted here (and shouldn't be — Stripe's pattern is already correct), but the modules use compatible storage so a future migration is straightforward.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — Graceful-degrade patterns hold
**Examples re-verified**:
- `useLeads` retry-on-missing-column → falls back to NARROW select (covered by `useLeads.helpers.test.ts`)
- `/api/exclusivity` table-missing → empty summary + no badges (covered by `locks.test.ts`)
- `/api/feedback` DB-fail → email-fail → local JSONL (pattern intact)
- `webhook_idempotency` table-missing → graceful-degrade in the helper (F1)
- `getEnv()` missing var in dev → warn + fallback; missing in production → throw early (per `src/lib/env.ts:43–58`)
- `hasStripe()`, `hasTwilio()`, `hasOpenAI()` boolean guards used by `/api/health` and any feature-flagged surface

**Severity**: Low (positive finding)
**Why it matters**: CLAUDE.md "feature-flags before migrations" rule. Every new column/table ships with code that survives if the SQL hasn't been applied yet.
**Delta tag**: UNCHANGED.

### F5. HEALTHY — Error boundaries cover the dashboard
**Files**:
- `src/app/error.tsx` — top-level error boundary
- `src/app/global-error.tsx` — global error
- `src/app/(auth)/error.tsx` — auth-area error
- `src/components/ui/error-boundary.tsx` — component-level (NEW since 2026-04-28)

**Severity**: Low (positive finding)
**Why it matters**: New `error-boundary.tsx` UI primitive available for component-level error wrapping. Each error page has a single intentional `console.error()` to log the digest for Sentry feedback (these 4 calls are part of the 10 remaining console.* calls and they are intentional).
**Recommended fix**: None. Optional: wrap `LeadDetailDrawer` in the new component-level boundary so a render error doesn't take down the dashboard.
**Delta tag**: NEW.

### F6. WATCH — No global retry/backoff helper for vendor calls
**Severity**: Low
**Why it matters**: 2026-04-28 audit flagged that vendor calls (Stripe, Twilio, Resend, OpenAI, enrichment sources) don't share a unified retry-with-exponential-backoff helper. Each module rolls its own (or none). Result: one-off 5xx from Stripe causes a hard fail rather than a 1-shot retry.
**Recommended fix**: Add `src/lib/utils/retry.ts` with `retryWithBackoff(fn, opts)` and migrate the highest-traffic vendor calls. ~3 hours.
**Delta tag**: UNCHANGED.

## Verdict

Reliability is HEALTHY and trending up. F2 (Twilio missed-call migrate-to-idempotency-module) is the only meaningful open item. F6 is quality-of-engineering rather than launch-blocker.
