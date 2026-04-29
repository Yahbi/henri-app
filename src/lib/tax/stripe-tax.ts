/**
 * Stripe Tax wrapper
 *
 * Phase 2.4 of the post-audit roadmap. Replaces the manual `taxRate`
 * input in the Estimate Builder with per-jurisdiction precision.
 *
 * ## Why Stripe Tax over alternatives
 *
 *   - **TaxJar**: $19+/mo subscription. Overkill at Beta scale.
 *   - **Avalara**: enterprise-priced.
 *   - **Stripe Tax**: $0.05/1k calls, no subscription. Henri already
 *     has a Stripe account for billing.
 *
 * At 100 contractors × 5 estimates/mo = 500 calls/mo = $0.025/mo.
 *
 * ## Activation
 *
 * Stripe Tax is OFF by default in Stripe accounts. To activate:
 *   1. Stripe dashboard → Tax → Activate
 *   2. Configure tax registrations for active states
 *   3. Set `STRIPE_TAX_ENABLED=1` in Vercel env
 *
 * Until activated, all calls fall back to the ZIP-fallback resolver
 * (Phase 1.6). The fallback returns ±0.5% accurate rates for ~95%
 * of US traffic.
 *
 * ## Cost gating
 *
 * Cache results by `(zip, line_items hash)` for 1 hour. Estimate
 * builder UX will re-render on every line-item edit; we don't want
 * to re-pay $0.00005 per keystroke. In-memory cache is fine for
 * Beta — promote to Redis at scale.
 */

import { getStripe } from "@/lib/stripe/client";
import { resolveTaxRate } from "./zip-fallback";
import type Stripe from "stripe";

/* ── Input / output shapes ──────────────────────────────────────────── */

export interface TaxInput {
  /** Subtotal in cents. */
  subtotal_cents: number;
  /** Customer billing address. Stripe Tax requires at least line1 + city
   *  + state + postal + country to compute special-district rates. */
  address: {
    line1?: string;
    city?: string;
    state?: string;
    postal_code: string;
    country: "US";
  };
  /** Stripe tax-code for the line item. Default is general
   *  taxable (`txcd_99999999`). Use `txcd_30040002` for construction
   *  services if your jurisdiction differentiates. */
  product_tax_code?: string;
}

export interface TaxResult {
  /** Tax owed in cents. */
  tax_cents: number;
  /** Effective combined rate (0..1). 0.0875 = 8.75%. */
  rate: number;
  /** Display-friendly source label. */
  label: string;
  /** "stripe-tax" when API call succeeded, "zip-fallback" otherwise. */
  source: "stripe-tax" | "zip-fallback";
  /** Optional per-jurisdiction breakdown when from Stripe Tax. */
  breakdown?: Array<{ jurisdiction: string; rate: number; amount_cents: number }>;
}

/* ── Cache ──────────────────────────────────────────────────────────── */

interface CacheEntry {
  result: TaxResult;
  expires_at: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheKey(input: TaxInput): string {
  return `${input.address.postal_code}|${input.address.state ?? ""}|${input.subtotal_cents}|${input.product_tax_code ?? ""}`;
}

/* ── Public API ─────────────────────────────────────────────────────── */

/**
 * Compute tax for an estimate. Tries Stripe Tax first; falls back to
 * the ZIP-resolver on any failure (graceful-degrade per CLAUDE.md).
 *
 * Cache hit → returns cached result without calling Stripe.
 *
 * Pure I/O: no DB writes, no side effects beyond the in-memory cache.
 */
export async function calculateTax(input: TaxInput): Promise<TaxResult> {
  // Cache check
  const key = cacheKey(input);
  const cached = cache.get(key);
  if (cached && cached.expires_at > Date.now()) {
    return cached.result;
  }

  // Fallback path: Stripe Tax disabled OR Stripe call fails
  if (process.env.STRIPE_TAX_ENABLED !== "1") {
    return zipFallback(input);
  }

  try {
    const stripe = getStripe();
    const calc = await stripe.tax.calculations.create({
      currency: "usd",
      line_items: [
        {
          amount: input.subtotal_cents,
          reference: "estimate-line",
          tax_code: input.product_tax_code ?? "txcd_99999999",
        },
      ],
      customer_details: {
        address: {
          line1: input.address.line1 ?? "",
          city: input.address.city ?? "",
          state: input.address.state ?? "",
          postal_code: input.address.postal_code,
          country: input.address.country,
        },
        address_source: "shipping",
      },
    });

    const tax_cents = calc.tax_amount_exclusive ?? 0;
    const rate = input.subtotal_cents > 0
      ? tax_cents / input.subtotal_cents
      : 0;
    const breakdown =
      calc.tax_breakdown?.map((b) => ({
        jurisdiction:
          (b as unknown as { jurisdiction?: { display_name?: string } })
            .jurisdiction?.display_name ?? "—",
        rate:
          Number(
            b.tax_rate_details?.percentage_decimal ?? "0",
          ) / 100,
        amount_cents: b.amount ?? 0,
      })) ?? [];

    const result: TaxResult = {
      tax_cents,
      rate,
      label: `via Stripe Tax (${input.address.postal_code})`,
      source: "stripe-tax",
      breakdown,
    };
    cache.set(key, { result, expires_at: Date.now() + CACHE_TTL_MS });
    return result;
  } catch {
    // Stripe Tax errors → fallback. Don't surface to the caller.
    return zipFallback(input);
  }
}

function zipFallback(input: TaxInput): TaxResult {
  const r = resolveTaxRate({
    zip: input.address.postal_code,
    state: input.address.state,
  });
  const tax_cents = Math.round(input.subtotal_cents * r.rate);
  const result: TaxResult = {
    tax_cents,
    rate: r.rate,
    label: `via ZIP estimate — ${r.label}`,
    source: "zip-fallback",
  };
  // Cache fallback results too (avoid re-computing the same ZIP every render)
  cache.set(cacheKey(input), {
    result,
    expires_at: Date.now() + CACHE_TTL_MS,
  });
  return result;
}

/* Force-resolve `Stripe` to silence unused-type warnings on builds where
 * Stripe.Tax isn't fully enumerated in the SDK type bundle. The runtime
 * call still hits the API the same way. */
type _StripeTaxRef = Stripe.Tax.Calculation;
