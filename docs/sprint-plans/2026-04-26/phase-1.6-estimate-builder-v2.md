# Phase 1.6 — Estimate builder v2 + Stripe Tax + branded PDF

**Effort**: 5–7d
**Status**: Pending

## Context

User audit: "Enhance the entire estimate builders. We need to have a pro and clean offer for the contractors. Make sure all taxes are accurate per zip code, city, states... Allow contractors to have more control/input."

Current state (`src/app/(dashboard)/dashboard/estimate/page.tsx`):
- Good/Better/Best tier multipliers from `src/lib/constants/trade-costs.ts`
- Manual `taxRate` text input (default 8.75) — no ZIP lookup
- Free-form line items
- Output is `window.print()` — no branded PDF

## Foundation already shipping

- Stripe is wired (`stripe` SDK in deps, webhook in `src/app/api/webhooks/stripe/`)
- `useEstimates` hook exists for CRUD
- `/api/estimates/send/route.ts` already sends via Resend + Twilio

## Scope (split into 3 sub-deliverables)

### A. Quick-win polish (Day 1)

- Add markup % field independent of tier multiplier
- Add notes / terms textarea (shown on PDF, not on the builder UI)
- ZIP-prefill default `taxRate` via static top-50 ZIP map (`src/lib/tax/zip-fallback.ts`) — covers ~90% of CA/TX/FL traffic with no API
- Material vs labor split per line item

### B. Stripe Tax integration (Days 2–3)

Stripe Tax is the canonical replacement for the manual `taxRate` field. Henri already has a Stripe account (used for billing). Stripe Tax is a per-transaction API:

```ts
// src/lib/tax/stripe-tax.ts
import { getStripe } from "@/lib/stripe/client";

export async function calculateTax(input: {
  amount: number;          // in cents
  customerAddress: { line1: string; city: string; state: string; postalCode: string; country: "US" };
  productCategory?: string; // e.g. "construction_services"
}): Promise<{ tax: number; rate: number; breakdown: TaxBreakdown[] }> {
  const stripe = getStripe();
  const calc = await stripe.tax.calculations.create({
    currency: "usd",
    line_items: [{
      amount: input.amount,
      reference: "estimate-line",
      tax_code: input.productCategory ?? "txcd_99999999",
    }],
    customer_details: { address: input.customerAddress, address_source: "shipping" },
  });
  return {
    tax: calc.tax_amount_exclusive,
    rate: calc.tax_breakdown[0]?.tax_rate_details?.percentage_decimal ? Number(calc.tax_breakdown[0].tax_rate_details.percentage_decimal) : 0,
    breakdown: calc.tax_breakdown,
  };
}
```

Cost: $0.05/1k calls. At 100 contractors × 5 estimates/mo = $0.025/mo. Negligible.

User action required: enable Stripe Tax in the Stripe dashboard (one-click), confirm tax registration in active states.

### C. Branded PDF rendering (Days 4–5)

Replace `window.print()` with server-rendered PDF via `@react-pdf/renderer`:

- `pnpm add @react-pdf/renderer`
- `src/lib/pdf/proposal-renderer.tsx` — React-PDF document component
- Cover page: contractor logo + license # + brand colors
- Line items page with tax breakdown
- Terms-and-conditions page
- POST `/api/estimates/[id]/pdf` returns the binary

Cost: pure CPU on Vercel; no per-call vendor cost.

### D. Line-item editor v2 (Days 6–7)

- Photo attachments per line item (Supabase Storage)
- Save-as-template flow (per-contractor template library)
- Inline calculator for cost-per-sqft helpers per trade

## Files

**New**:
- `src/lib/tax/zip-fallback.ts` (Day 1)
- `src/lib/tax/stripe-tax.ts` (Days 2–3)
- `src/lib/pdf/proposal-renderer.tsx` (Days 4–5)
- `src/app/api/estimates/[id]/pdf/route.ts` (Days 4–5)

**Modified**:
- `src/app/(dashboard)/dashboard/estimate/page.tsx`
- `src/app/api/estimates/send/route.ts` — attach the PDF to outbound emails

**Dependencies**:
- `@react-pdf/renderer` (~+450KB to server bundle, irrelevant for Vercel functions)

## Verification

- tsc + eslint + vitest clean
- Manual: build estimate for a Hartford CT lead — Stripe Tax returns CT 6.35% + city +0.0%
- Manual: build same estimate for a New Orleans lead — Stripe Tax returns 9.45% (LA 4.45 + Orleans Parish 5.0)
- Manual: PDF renders with logo + license + line items + tax breakdown — opens in any PDF viewer
- Email send: `/api/estimates/send` attaches the PDF binary

## Out of scope

- Stripe Tax registration in every state (user/legal team's job)
- Multi-currency support
- Recurring estimates / change orders (separate workflow)
- Customer-side approval flow ("E-sign here") — would need DocuSign integration, not in this scope
