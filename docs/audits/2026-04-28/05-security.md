# 05 — Security

## TL;DR

Security posture improved substantially since 2026-04-26: **security headers wired** in `next.config.ts`, **LLM injection defenses shipped** (S1+S2 — `<<<REVIEW>>>` delimiters, output-pattern reject, per-answer caps), **god-mode audit log shipped** (S6 — structured `console.warn` JSON line), **Stripe reorder fix shipped** (B3 — insert→coupon→update), **ILIKE pattern escape shipped** (B6 — `eq` instead of `ilike` in queryAddressSiblings). The two open WATCH items are **Twilio + Resend webhook idempotency** and the **14 unvalidated POSTs** documented in [04-api-surface.md F1](./04-api-surface.md).

## Score

**HEALTHY** — most prior open issues closed; remaining gaps are mechanical (Zod on 14 POSTs + 2 idempotency keys).

## Findings

### A1. HEALTHY — Service-role key isolated to server modules
**File**: `src/lib/supabase/admin.ts`
**Why it matters**: CLAUDE.md "service-role key never reaches the browser" rule. Grep confirms no client-side imports; the `createAdminClient()` factory is only imported from cron routes, webhook handlers, and other server-only modules.
**Status**: No regressions.

### A2. HEALTHY — Env validation fails closed in production
**File**: `src/lib/env.ts:38-60`
**Why it matters**: Missing required env in production throws (line 48); dev mode warns and returns fallback. Insecure `CRON_SECRET` defaults (`change_me`, `secret`, etc.) explicitly rejected (line 52-57). Belt-and-suspenders against the deployment-with-default-secrets failure mode.
**Status**: No action.

### A3. HEALTHY — god-mode bypass audit log live
**File**: `src/middleware.ts:59-78`
**Why it matters**: S6 fix shipped — every god-mode request emits a structured `console.warn` JSON line with `email`, `user_id`, `path`, `ip` (from `x-forwarded-for`), and `ts`. CLAUDE.md "god-mode is privileged short-circuit; needs audit trail" rule. Without this, a compromised allowlist email or misconfigured `GOD_MODE_EMAILS` env var leaves no trace.
**Status**: Confirmed in spot-check.

### A4. HEALTHY — LLM injection defense shipped on `/api/ai/draft-reply` + `/api/chat/refine`
**Files**: `src/app/api/ai/draft-reply/route.ts:27-45, 57-77, 120-138`, `src/app/api/chat/refine/route.ts:79-150`
**Why it matters**: S1+S2 fixes shipped:
- Zod schema caps text length (2000 chars on review text, 500 chars per answer × 3 answers)
- User content wrapped in `<<<REVIEW>>>...<<<END_REVIEW>>>` and `<<<ANSWER N>>>...<<<END_ANSWER>>>` delimiters
- System prompt explicitly instructs LLM to treat delimited content as data
- Sanitizer strips delimiter sentinels from input (so an attacker can't close the delimiter early)
- Output-pattern reject: anything containing URL / phone / JSON-shape / delimiter echo falls back to canned reply
**Status**: Defense-in-depth across 3 layers (Zod → prompt → output filter).

### A5. HEALTHY — Stripe webhook is exemplary
**File**: `src/app/api/webhooks/stripe/route.ts`
**Why it matters**: 
- Signature verified via `stripe.webhooks.constructEvent()` BEFORE `JSON.parse()`
- Idempotent on `event.id` (logged via `logBillingEvent()` with unique constraint `uq_billing_events_stripe_event_id` from migration 00007)
- No client-controlled IDs read from request body
- B3 reorder fix shipped: referral-credit INSERT placeholder → CREATE Stripe coupon → UPDATE row with real coupon_id (eliminates duplicate coupons under at-least-once webhook delivery)
**Status**: Reference implementation.

### A6. HEALTHY — Security headers wired in `next.config.ts`
**File**: `next.config.ts:8-21`
**Why it matters**: 
- `X-Frame-Options: SAMEORIGIN` — anti-clickjacking
- `X-Content-Type-Options: nosniff` — MIME sniffing block
- `Referrer-Policy: strict-origin-when-cross-origin` — privacy
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()` — feature lockdown
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — HSTS (2-year)
- `X-DNS-Prefetch-Control: on` — perf
Applied to every route via `headers()` async function.
**Status**: Closes prior audit's #8 priority.

### A7. WATCH — Resend webhook lacks idempotency key
**File**: `src/app/api/webhooks/resend/route.ts:15-50`
**Severity**: Medium
**Why it matters**: Resend (Svix-shaped) signature verification + 5-min timestamp window are present, but no per-event dedup. Replayed webhook could fire duplicate notifications/state-updates. Stripe is the gold standard here; Resend should match.
**Recommended fix**: Store processed `svix-id` in DB; check before processing. Migration: `CREATE TABLE IF NOT EXISTS webhook_idempotency (provider text, event_id text, processed_at timestamptz, PRIMARY KEY (provider, event_id))`. ~1 hour.

### A8. WATCH — Twilio webhook lacks idempotency key
**File**: `src/app/api/webhooks/twilio/route.ts:17-50`
**Severity**: Medium
**Why it matters**: Twilio webhook validates signature + parses `MessageSid` but lacks dedup. Duplicate webhook → duplicate status update.
**Recommended fix**: Same shared `webhook_idempotency` table as A7. Use `MessageSid` as event_id. ~1 hour.

### A9. ISSUE — 14 POST routes still missing Zod
**Files**: See [04-api-surface.md F1](./04-api-surface.md) for full list.
**Severity**: High (compound across 14 routes)
**Why it matters**: Same root cause as 04-F1; financial / compliance / admin metadata could be corrupted.

### A10. HEALTHY — Foreign-domain filter holds in importers
**Files**: `scripts/import-live-master.ts:178-191`, `scripts/import-perfected-csv.ts`, `scripts/import-master-json.ts`
**Why it matters**: Earlier sessions caught Colombian (`datos.gov.co`) data slipping through one of the upstream curated CSVs. The defensive filter at the importer layer drops `.gov.co`, `.gob.mx`, `.gov.uk`, `.gov.ca`, and any `\.gov\.[a-z]{2,3}$` pattern. Henri's data must remain US-only.
**Status**: No regressions.

### A11. HEALTHY — `/api/dev/*` gated by `NEXT_PUBLIC_ENABLE_DEV_LOGIN`
**File**: `src/app/api/dev/auto-login/route.ts:23-26`
**Why it matters**: Returns 404 when the flag isn't set; even direct `POST` against the production URL fails. The flag is never set in Vercel production env.
**Status**: Confirmed; the dev-login button on `/login` is also conditionally rendered.

### A12. HEALTHY — Permit-relevance + permit/marriage/firearm negative filter
**File**: `scripts/import-live-master.ts:140-155, 168-185`
**Why it matters**: Importers reject film/marriage/marijuana/firearm/concealed-carry/skate-park rows even if the upstream CSV claims them as "permits". Henri sells construction leads, not lifestyle data. Defensive filter prevents accidentally enabling a lead pipeline that contradicts the brand promise.
**Status**: No regressions.

### A13. HEALTHY — ILIKE pattern injection closed (B6)
**File**: `src/lib/enrichment/orchestrator.ts:queryAddressSiblings`
**Why it matters**: B6 fix earlier this session changed `.ilike("address", address)` → `.eq("address", address)`. Addresses containing `%`, `_`, `\` no longer cause unexpected pattern matches. Subtle but real.
**Status**: Confirmed.

## Diff vs 2026-04-26

### Closed
- A6 (security headers) — was open #8 priority
- A4 (LLM injection) — was open #5 priority (S1+S2 fixes shipped)
- A3 (god-mode audit log) — was open S6 (this session)
- A5 (Stripe reorder) — was open B3 (this session)
- A13 (ILIKE injection) — was open B6 (this session)

### Open
- A7+A8 (Twilio/Resend idempotency) — new finding
- A9 (14 unvalidated POSTs) — partial close (7 of 17 done; 14 remaining)
- LLM safety audit (prior #5) — partially closed; the AI/chat surfaces are hardened but `/api/agents/*` posts are still unvalidated
