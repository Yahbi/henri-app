# Phase 2.4 — Stripe Tax v2 (replace ZIP-prefill with full Stripe Tax API)

**Effort**: 3d
**Prereqs**: Phase 1.6 estimate-builder v2 ZIP-prefill deployed
**Status**: Pending

## Context

Phase 1.6 ships a top-50-ZIP fallback table for the estimate builder's tax field. That covers 90% of CA/TX/FL traffic with no API call. For the remaining 10% (and for accuracy in special-district cities like Chicago, where tax can vary by 1.0% within ZIP boundaries), wire Stripe Tax.

## Foundation already shipping

- Phase 1.6 `src/lib/tax/zip-fallback.ts` — the ZIP map (now becomes the fallback)
- Phase 1.6 `src/lib/tax/stripe-tax.ts` — the API wrapper (Phase 1.6 includes the wrapper but uses ZIP fallback; this phase flips the priority)

## Scope

### Day 1: switch primary path

In `src/app/(dashboard)/dashboard/estimate/page.tsx`:

```ts
// Before (Phase 1.6):
const taxRate = useMemo(() => zipFallback(lead.zip), [lead.zip]);

// After (Phase 2.4):
const taxRate = useStripeTax({ lead, lineItems });
//   • calls /api/estimates/preview-tax (new route)
//   • falls back to zipFallback on Stripe error or rate limit
```

### Day 2: API route

`src/app/api/estimates/preview-tax/route.ts`:
- Accepts `{ lead_id, line_items }` body
- Calls `stripe.tax.calculations.create(...)`
- Returns `{ tax_amount, rate, breakdown, source: "stripe-tax" | "zip-fallback" }`
- On error: falls back to ZIP-fallback, sets `source: "zip-fallback"`

### Day 3: telemetry + verification

- Track Stripe Tax API call cost in `tax_api_calls` table (per-day rollup)
- Drawer shows tax source: "via Stripe Tax" (green badge) or "via ZIP estimate" (yellow badge)
- Manual test: build estimates in 5 different cities, verify breakdown matches state Department of Revenue published rates within 0.01%

## Files

**New**:
- `src/app/api/estimates/preview-tax/route.ts`
- `src/hooks/useStripeTax.ts`
- `supabase/migrations/00051_tax_api_calls.sql`

**Modified**:
- `src/app/(dashboard)/dashboard/estimate/page.tsx` — switch primary path
- `src/lib/tax/stripe-tax.ts` — already exists from Phase 1.6, expand if needed

## User-action prerequisites

1. Enable Stripe Tax in dashboard: Stripe → Tax → Activate
2. Configure tax registrations for active states (Stripe walks through this)
3. Set `STRIPE_TAX_ENABLED=1` in Vercel env
4. Confirm test-mode tax calculations work before flipping live

## Cost

At 100 contractors × 5 estimates/mo × 1 tax call per estimate = 500 calls/mo.
Stripe Tax: $0.05/1k calls = $0.025/mo. Negligible.

## Verification

- 6+ unit tests on the new hook (cache hit, fallback path, malformed response)
- Production check: 7 days post-deploy, `tax_api_calls.source` distribution should be ~95% Stripe, ~5% ZIP fallback

## Out of scope

- Tax exemption certificates (B2B sales to other contractors) — Stripe supports it, deferred for later
- Multi-jurisdiction (Canada, Mexico) — Stripe Tax supports but Henri is US-only
- Sales tax filing automation — separate workflow, separate vendor
