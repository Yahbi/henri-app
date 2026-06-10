/**
 * POST /api/estimates/preview-tax
 *
 * Phase 1.6/2.4 client-server bridge. The Estimate Builder calls this
 * route to get a tax breakdown for a draft estimate without writing
 * anything to the DB.
 *
 * Flow:
 *   1. Validate body (Zod) — `subtotal_cents`, `address`, optional `product_tax_code`
 *   2. requireContractor — only paying contractors can hit Stripe Tax
 *   3. calculateTax() — Stripe Tax with ZIP-fallback graceful-degrade
 *   4. Return `{ tax_cents, rate, label, source, breakdown }`
 *
 * Cost: ~$0.00005 per call, cached 1h. Estimate UX renders this on
 * input change, but the cache keeps repeated keystrokes free.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { calculateTax } from "@/lib/tax/stripe-tax";
import { logApiError } from "@/lib/log";

const PreviewTaxBody = z.object({
  subtotal_cents: z.number().int().min(0).max(1_000_000_000),
  address: z.object({
    line1: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state: z.string().length(2).optional(),
    postal_code: z.string().regex(/^\d{5}$/, "5-digit US ZIP required"),
    country: z.literal("US"),
  }),
  product_tax_code: z.string().max(50).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Auth before parse (2026-06-10): anonymous probes must not receive
    // schema-shaped validation errors.
    const supabase = await createClient();
    const auth = await requireContractor(supabase);
    if (auth.response) return auth.response;

    let parsed;
    try {
      parsed = PreviewTaxBody.parse(await req.json());
    } catch (zodErr) {
      const issues = zodErr instanceof z.ZodError ? zodErr.issues : [];
      return NextResponse.json(
        { error: "Invalid body", issues },
        { status: 400 },
      );
    }

    const result = await calculateTax(parsed);
    return NextResponse.json(result);
  } catch (err) {
    logApiError("estimates.previewTax", err);
    return NextResponse.json(
      { error: "Tax preview failed" },
      { status: 500 },
    );
  }
}
