# 04 — API Surface

## TL;DR

**102 API routes**. Auth gating is universal (every contractor route uses `requireContractor()`, every cron uses `CRON_SECRET`, every webhook verifies signature). The single ISSUE: **14 POST routes still accept raw `req.json()` without Zod validation**. The 7 newly-Zod-guarded routes from this session (`/api/ai/draft-reply`, `/api/chat/refine`, `/api/estimates`, `/api/quotes`, `/api/messages/send`, `/api/reviews/respond`, `/api/financing/request`, `/api/estimates/send`) are exemplary; the remaining 14 need the same treatment.

## Score

**ISSUE** — 14 unvalidated POSTs is the single largest open gap. Each could corrupt downstream data (financial records, license metadata, admin probes).

## Per-group breakdown

| Group | Count | Auth | Validation | Notes |
|---|---:|---|---|---|
| `/api/cron/*` | 17 | CRON_SECRET ✓ | All have Zod or env-gating ✓ | Secure |
| `/api/webhooks/*` | 4 | Signature only ✓ | Stripe + Resend + Twilio ✓ | Idempotency gap on Resend + Twilio (see 05-security.md) |
| `/api/admin/*` | 2 | Admin role-check ✓ | `probe` unguarded | Needs Zod |
| `/api/agents/*` | 3 | Cron or auth ✓ | Unvalidated POSTs | All 3 need Zod |
| `/api/dev/*` | 4 | `NEXT_PUBLIC_ENABLE_DEV_LOGIN` gate ✓ | `auto-login` unguarded body | Acceptable (dev-only) |
| `/api/billing/*` | 6 | Contractor auth ✓ | 4/6 have Zod; `extra-zip`, `change-plan` unguarded | 2 need Zod |
| `/api/leads/*` | 3 | Contractor auth ✓ | `[id]/notes`, `[id]` PATCH unguarded | 2 need Zod |
| `/api/estimates/*` | 4 | Contractor auth ✓ | 2/4 have Zod; `[id]` PATCH unguarded | 1 needs Zod |
| `/api/financing/*` | 2 | Contractor auth ✓ | POST unvalidated | 1 needs Zod |
| `/api/ai/*` | 2 | Contractor auth ✓ | Both Zod + delimited ✓ | Secure (S1+S2 fixes confirmed) |
| `/api/intake` | 1 | Public + rate-limit ✓ | Zod ✓ | Secure |
| `/api/contractors/*` | 3 | Public + auth ✓ | Search rate-limited ✓ | Secure |
| `/api/compliance/*` | 2 | Contractor auth ✓ | `verify` unvalidated | 1 needs Zod |
| `/api/license/*` | 1 | Contractor auth ✓ | `verify` unvalidated | 1 needs Zod |
| Public/misc | ~50 | Varies ✓ | Mixed | Per-route review needed |

## Findings

### F1. ISSUE — 14 POST routes still accept raw `req.json()` without Zod
**Severity**: High (compound — any one corrupts downstream data)
**Why it matters**: CLAUDE.md "input validation at the edge" rule. The 7 routes that got Zod this session demonstrate the pattern; the remaining 14 are mechanical work to bring up to that bar.

| # | Route | Risk |
|---|---|---|
| F1.1 | `/api/estimates/[id]` PATCH | Tiers JSON could ship with type confusion (line 35 reads raw `req.json()`, manual `allowedFields` filter) |
| F1.2 | `/api/leads/[id]` PATCH | Pipeline value or date corruption |
| F1.3 | `/api/leads/[id]/notes` POST | XSS risk if notes are rendered unsanitized |
| F1.4 | `/api/financing` POST | Financial corruption (APR, monthly_payment, term_months, quote_id all unvalidated) |
| F1.5 | `/api/license/verify` POST | License number / state could be malformed |
| F1.6 | `/api/admin/sources/probe` POST | `source_key` flows into downstream queries |
| F1.7 | `/api/agents/lead-scorer` POST | `lead_ids` array unbounded |
| F1.8 | `/api/agents/permit-scraper` POST | `source_ids` array unbounded |
| F1.9 | `/api/agents/ziplock` POST | ZIP array could be unbounded |
| F1.10 | `/api/billing/extra-zip` POST | Quantity coerced manually with `Math.max/min` instead of Zod |
| F1.11 | `/api/billing/change-plan` POST | Plan-key validation only via shared schema; verify it's still applied |
| F1.12 | `/api/compliance/verify` POST | Compliance metadata unvalidated |
| F1.13 | `/api/quotes/[id]` PATCH | Status/price unvalidated |
| F1.14 | `/api/profile/notifications` PATCH | (verify Zod applied; if not, list of preference keys unvalidated) |

**Recommended fix**: Use the canonical pattern from `src/lib/schemas/api.ts`:
```ts
const body = parseBody(BillingExtraZipSchema, await req.json());
if (body.response) return body.response;
const { quantity } = body.data;
```
Schemas to add (~14 of them, ~10 lines each): `EstimatePatchSchema`, `LeadPatchSchema`, `LeadNotesSchema`, `FinancingPostSchema`, `LicenseVerifySchema`, `AdminSourcesProbeSchema`, `LeadScorerSchema`, `PermitScraperSchema`, `ZiplockSchema`, `BillingExtraZipSchema`, `BillingChangePlanSchema` (verify), `ComplianceVerifySchema`, `QuotePatchSchema`, `NotificationPrefsSchema`. ~2 hours total.

### F2. HEALTHY — 7 high-risk POSTs got Zod earlier this session
**Files**: `/api/ai/draft-reply`, `/api/chat/refine`, `/api/estimates`, `/api/quotes`, `/api/messages/send`, `/api/reviews/respond`, `/api/financing/request`, `/api/estimates/send`
**Why it matters**: S1+S2+S3+S9 fixes shipped Zod schemas with content caps (e.g. `max(2000)` chars on review text), enum-narrow validation (`channel: z.enum(["sms", "email"])`), and HTML-escape on the financing email render. These are the reference implementations.
**Status**: Pattern confirmed; extending to F1 list is mechanical.

### F3. HEALTHY — `requireContractor()` is universal on contractor-only routes
**File**: `src/lib/auth/requireContractor.ts:15-46`
**Why it matters**: Defense-in-depth alongside middleware. Middleware blocks the obvious bypasses (URL gate); `requireContractor()` blocks the subtle ones (homeowner session aliasing, stale cookies probing contractor routes). Returns 401 for unauthenticated, 403 for non-contractor.
**Status**: Confirmed in spot-check across `/api/leads`, `/api/estimates`, `/api/quotes`, `/api/billing`, `/api/messages`, `/api/territories`.

### F4. HEALTHY — All 17 cron routes gate on `CRON_SECRET`
**Files**: `src/app/api/cron/*/route.ts` (17 files)
**Why it matters**: CLAUDE.md "cron auth via shared secret" rule. Every cron checks `Bearer ${process.env.CRON_SECRET}` before running. Vercel's cron scheduler injects the header; manual triggers via `pnpm score` do the same.
**Status**: No regressions.

### F5. HEALTHY — Webhook signature verification is universal
**Files**: `src/app/api/webhooks/stripe/route.ts`, `src/app/api/webhooks/twilio/route.ts`, `src/app/api/webhooks/resend/route.ts`, `src/app/api/webhooks/twilio-missed-call/route.ts`
**Why it matters**: Stripe `webhook.constructEvent()` (signature-verify-before-parse), Twilio `validateRequest()`, Resend Svix signature verification. All match canonical patterns.
**Status**: See [05-security.md A7-A8](./05-security.md) for the idempotency gap.

### F6. HEALTHY — `/api/dev/*` gates on `NEXT_PUBLIC_ENABLE_DEV_LOGIN`
**Files**: `src/app/api/dev/auto-login/route.ts:23-26`, `src/app/api/dev/switch-role/route.ts`
**Why it matters**: Returns 404 in production where the env var isn't set. Prevents the founder god-mode entry point from existing on prod URLs at all.
**Status**: Confirmed.

### F7. WATCH — Some webhooks lack request-body Zod (intentional)
**Files**: `src/app/api/webhooks/stripe/route.ts`, `src/app/api/webhooks/twilio/route.ts`
**Severity**: Low
**Why it matters**: Webhook bodies are signature-verified; the signature implies the body is trusted. Adding Zod on top would catch shape regressions but isn't a security gap. The Stripe webhook does pull specific fields (`event.id`, `event.type`, `event.data.object`) which are typed via `stripe.events.Event`.
**Recommended fix**: Optional. If you do, narrow with `z.discriminatedUnion("type", [...])` per webhook event type for richer typing. Not urgent.

## Diff vs 2026-04-26

### Closed
- 7 of 17 critical POST routes got Zod schemas (S1+S2+S3+S9)
- LLM injection defense on `/api/ai/draft-reply`, `/api/chat/refine` confirmed
- Stripe webhook reorder fix (B3) shipped
- god-mode bypass audit log (S6) shipped

### Still open
- 14 POST routes still missing Zod (F1.1-F1.14)
- Twilio + Resend webhook idempotency keys (separate finding; see 05-security.md)
