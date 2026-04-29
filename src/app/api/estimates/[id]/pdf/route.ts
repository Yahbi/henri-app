/**
 * GET /api/estimates/:id/pdf
 *
 * Phase 1.6 Day 4-5 — server-rendered branded PDF for an estimate.
 * Replaces the client-side `window.print()` flow.
 *
 * Falls back to JSON 503 when `@react-pdf/renderer` isn't installed
 * yet — graceful-degrade per CLAUDE.md. Until `pnpm add @react-pdf/
 * renderer`, the existing print flow continues to work; this route
 * just returns 503.
 *
 * Auth: requireContractor — only the owning contractor can pull a PDF
 * of their own estimate. RLS would also block cross-contractor reads
 * but we double-check at the API layer.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { renderProposalPdf, type ProposalInput } from "@/lib/pdf/proposal-renderer";
import { calculateTax } from "@/lib/tax/stripe-tax";
import { logApiError } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 30;

interface EstimateRow {
  id: string;
  contractor_id: string;
  lead_id: string | null;
  customer_address: string | null;
  total_amount: number | null;
  notes: string | null;
  line_items: unknown;
  tier_multiplier: number | null;
  created_at: string;
}

interface ProfileRow {
  full_name: string | null;
  company_name: string | null;
  license_number: string | null;
  license_state: string | null;
  phone: string | null;
  email: string | null;
}

interface LeadRow {
  owner_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const supabase = await createClient();
    const auth = await requireContractor(supabase);
    if (auth.response) return auth.response;
    const user = auth.user;

    const { data: estimate } = await supabase
      .from("estimates")
      .select("*")
      .eq("id", id)
      .eq("contractor_id", user.id)
      .single<EstimateRow>();
    if (!estimate) {
      return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, company_name, license_number, license_state, phone, email")
      .eq("id", user.id)
      .single<ProfileRow>();

    let lead: LeadRow | null = null;
    if (estimate.lead_id) {
      const { data: leadData } = await supabase
        .from("leads")
        .select("owner_name, address, city, state, zip")
        .eq("id", estimate.lead_id)
        .eq("contractor_id", user.id)
        .single<LeadRow>();
      lead = leadData ?? null;
    }

    // Tax breakdown — call the Stripe Tax wrapper at PDF-render time
    // so the tax rate matches the actual jurisdiction. Falls back to
    // ZIP estimator inside calculateTax() automatically.
    const subtotalCents = Math.round((estimate.total_amount ?? 0) * 100);
    const tax = await calculateTax({
      subtotal_cents: subtotalCents,
      address: {
        line1: lead?.address ?? estimate.customer_address ?? "",
        city: lead?.city ?? "",
        state: lead?.state ?? "",
        postal_code: lead?.zip ?? "",
        country: "US",
      },
    });

    /* Map DB rows → ProposalInput. */
    const lineItems = Array.isArray(estimate.line_items)
      ? (estimate.line_items as unknown[]).map((raw) => {
          const item = raw as Record<string, unknown>;
          return {
            material: String(item.material ?? "Item"),
            quantity: Number(item.quantity ?? 1),
            unit: String(item.unit ?? "item"),
            unit_price_cents: Math.round(Number(item.unitPrice ?? 0) * 100),
          };
        })
      : [];

    const input: ProposalInput = {
      contractor: {
        company_name: profile?.company_name ?? profile?.full_name ?? "Contractor",
        license_number: profile?.license_number ?? null,
        license_state: profile?.license_state ?? null,
        phone: profile?.phone ?? null,
        email: profile?.email ?? null,
      },
      customer: {
        name: lead?.owner_name ?? "Customer",
        address: lead?.address ?? estimate.customer_address ?? "",
        city: lead?.city ?? null,
        state: lead?.state ?? null,
        zip: lead?.zip ?? null,
      },
      estimate: {
        estimate_id: estimate.id,
        project_title: estimate.notes?.split("\n")[0] ?? "Estimate",
        description: estimate.notes ?? "",
        line_items: lineItems,
        tax: {
          rate: tax.rate,
          amount_cents: tax.tax_cents,
          label: tax.label,
        },
        tier_multiplier: estimate.tier_multiplier ?? 1,
        terms:
          "This estimate represents our best assessment of project scope at the time of quote. " +
          "Material lead times, hidden conditions, and change orders may adjust the final invoice. " +
          "Cancel anytime before work begins for a full refund of any deposit.",
        valid_for_days: 14,
        generated_at: new Date().toISOString(),
      },
    };

    const buffer = await renderProposalPdf(input);
    if (!buffer) {
      return NextResponse.json(
        {
          error:
            "PDF rendering not available — install @react-pdf/renderer (`pnpm add @react-pdf/renderer`)",
        },
        { status: 503 },
      );
    }

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="estimate-${id.slice(0, 8)}.pdf"`,
      },
    });
  } catch (err) {
    logApiError("estimates.pdf", err);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  }
}
