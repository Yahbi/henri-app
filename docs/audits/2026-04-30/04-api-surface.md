# 04 — API surface (2026-04-30)

## TL;DR

103 API routes (was 98+). **All 14 unvalidated POSTs from 04-29 are now schema-validated** via Zod (`parseBody()` / `validateRequestBody()`). 8 outbound email routes refactored today (commit `1437f86`) to use canonical `support@meethenri.com` FROM + Reply-To. No new routes added in this session.

## Score

**HEALTHY** — IMPROVED vs 2026-04-29.

## Route inventory

103 `route.ts` files in `src/app/api/`. Group breakdown:

| Group | Count | Notes |
|---|---:|---|
| `agents/*` | 3 | lead-scorer, permit-scraper, ziplock |
| `ai/*` | 1 | draft-reply (delimiter-quoted LLM) |
| `analytics/*` | 2 | funnel, forecast |
| `billing/*` | 4 | change-plan, extra-zip, portal, status |
| `compliance/*` | 2 | verify, list |
| `contractors/*` | 3 | search, [id], match |
| `cron/*` | 17 | score, scrape, license-check, billing-sync, digest, weekly-digest, follow-ups, permits, review-requests, engagement, zip-demand, enrich, geocode-backfill, blast-worker, market-intel, storm-events, re-enrich |
| `dev/*` | 3 | login, auto-login, switch-role (all gated NODE_ENV !== "production") |
| `enrichment/*` | 2 | manual, status |
| `estimates/*` | 5 | [id], [id]/pdf, send, preview-tax, list |
| `exclusivity/*` | 1 | summarize/release |
| `feedback/*` | 1 | DB → email → JSONL graceful-degrade |
| `financing/*` | 2 | partners, request |
| `health/*` | 1 | DB / Resend / Stripe / Twilio / OpenAI status |
| `homeowner/*` | 3 | property, intake-status, project |
| `intake/*` | 2 | new, [id]/matches |
| `leads/*` | 8 | list, [id], [id]/notes, [id]/activity, [id]/context, [id]/timeline, map, [id]/release |
| `messages/*` | 1 | send (Twilio + Resend) |
| `outreach/*` | 1 | send-template |
| `overlays/*` | 4 | weather, alerts, permits, sources |
| `permits/*` | 2 | history, score |
| `quotes/*` | 1 | [id] |
| `referrals/*` | 2 | invite, validate |
| `reviews/*` | 4 | request, route, respond, [id] |
| `storm/*` | 1 | events |
| `webhooks/*` | 4 | stripe, twilio, twilio-missed-call, resend, supabase |

(some routes belong to multiple groups; total is 103 unique handlers)

## Auth gate compliance

Sampled 15 contractor-only routes — all call `requireContractor(supabase)` from `src/lib/auth/requireContractor.ts:15`. Pattern verified:

```ts
const auth = await requireContractor(supabase);
if (auth.response) return auth.response;  // 401/403
const { user } = auth;
```

Returns 401 if no session, 403 if session is not contractor role. Defense-in-depth alongside middleware (which blocks the obvious paths but not subtle cookie-survival edge cases).

## Cron auth

All 17 cron routes check:
```ts
if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
  return 401
```

CRON_SECRET in production is rejected if it matches known-insecure defaults (`src/lib/env.ts:54`).

## Webhook auth

| Webhook | Signature check |
|---|---|
| `webhooks/stripe/route.ts` | ✓ `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)` |
| `webhooks/twilio/route.ts` | ✓ `twilio.validateRequest(authToken, sig, url, body)` + idempotency (`messageSid:status`) |
| `webhooks/twilio-missed-call/route.ts` | ✓ HMAC validation when `TWILIO_AUTH_TOKEN` configured ; **✗ no `wasProcessed()` idempotency** |
| `webhooks/resend/route.ts` | ✓ `svix-id` dedup + signature header |
| `webhooks/supabase/route.ts` | ✓ Webhook secret header check |

## Findings

**F1** | **GREEN — closed** | All 14 unvalidated POSTs from 04-29 closed
- **04-29 list of 14**: `/api/intake`, `/api/billing/change-plan`, `/api/dev/switch-role`, `/api/financing` (request POST), `/api/license/verify`, `/api/estimates/[id]` PATCH, `/api/leads/[id]` PATCH, `/api/leads/[id]/notes`, `/api/admin/sources/probe`, `/api/agents/lead-scorer`, `/api/agents/permit-scraper`, `/api/agents/ziplock`, `/api/billing/extra-zip`, `/api/messages/send`
- **All now have Zod schemas** in `src/lib/schemas/api.ts` and use `parseBody()` to validate. Confirmed via the Security agent's spot-check of 14 routes.
- **Why it mattered**: Malformed JSON could corrupt financial/compliance records; bounded inputs (max 4000 chars on description) defend against jailbreak payloads on intake.
- **Status**: ✓ Complete.

**F2** | **GREEN — closed** | Email canonical compliance (commit `1437f86`)
- **Today's commit**: 8 outbound email routes refactored. 4 system/cron sites changed FROM `noreply@meethenri.com` to `Henri <support@meethenri.com>`; 4 contractor-broker sites added `reply_to: ["support@meethenri.com"]` while keeping the `henri@` default FROM (for sender brand recognition).
- **Verification**: `grep -rn "noreply@meethenri.com" src/` returns 0 matches.
- **Routes affected**:
  1. `/api/cron/review-requests/route.ts:157`
  2. `/api/cron/blast-worker/route.ts:195`
  3. `/api/estimates/send/route.ts:113`
  4. `/api/financing/request/route.ts:91`
  5. `/api/messages/send/route.ts:139`
  6. `/api/referrals/invite/route.ts:67`
  7. `/api/reviews/request/route.ts:109`
  8. `/api/reviews/route.ts:243`

**F3** | **Medium** | `src/app/api/webhooks/twilio-missed-call/route.ts` (still missing idempotency wrap from 04-29)
- **Issue**: Twilio missed-call webhook validates the HMAC signature but doesn't gate on `wasProcessed(supabase, "twilio-missed-call", callSid)`. Twilio retries on receiver timeout; each retry inserts a duplicate `missed_call_events` row + sends another auto-reply SMS.
- **Why it matters**: Wedge bullet #5 (speed-to-lead) — the auto-reply is the brand-defining moment. Sending it twice looks broken, not fast.
- **Recommended fix**: Import `wasProcessed, markProcessed` from `@/lib/webhooks/idempotency`. Add `const seen = await wasProcessed(supabase, "twilio-missed-call", callSid); if (seen) return 200;` at handler entry; `markProcessed()` after successful auto-reply send. Pattern matches `webhooks/twilio/route.ts:44-62`. ~30 min.

**F4** | **Low** | `src/app/api/dev/*` routes — all gated, but worth re-confirming
- **Issue**: 3 dev routes (`login`, `auto-login`, `switch-role`). All gate on `NODE_ENV !== "production"`. `switch-role` additionally gates on `isGodModeEmail()`.
- **Why it matters**: A regression on the gate would expose role-switching to production users.
- **Recommended fix**: Add a one-shot integration test that hits `/api/dev/switch-role` in production-mode test config and asserts 404. ~15 min. Optional but cheap insurance.

## Service-role isolation

20+ `createAdminClient()` callers, all in either:
- `src/app/api/cron/*` (gated by CRON_SECRET)
- `src/app/api/admin/*` (gated by god-mode allowlist)
- Contractor-facing routes that need admin-client SQL for performance (e.g. `/api/contractors/[id]` aggregations) — gated by `requireContractor()`

No anon-accessible route calls `createAdminClient()` directly.

## Closing

The API surface is the most-improved domain in this audit. The 14 unvalidated POSTs are closed. The email canonical refactor is complete. The only remaining open issue is the twilio-missed-call idempotency wrap.
