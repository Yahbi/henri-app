import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { isUuid } from "@/lib/validation/params";

export const runtime = "nodejs";

/**
 * POST /api/leads/[id]/view-contact — log a contact-info view (WS7).
 *
 * PURE ANALYTICS. No user-facing counter, no gating, no credit/reveal UI.
 * Feeds the "historical conversion" score signal + COGS-per-territory data.
 * Henri has NO per-lead fees — this logging is invisible to the contractor.
 *
 * Best-effort: always returns { ok: true } even if the insert fails, so
 * analytics never block the user. No request body needed. Not idempotent —
 * every view is a data point.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const guard = await requireContractor(supabase);
  if (guard.response) return guard.response;

  const { id: leadId } = await ctx.params;
  if (!isUuid(leadId)) {
    return NextResponse.json({ error: "Malformed lead id" }, { status: 400 });
  }

  // Verify the lead is visible to the caller (RLS-scoped) before logging.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .maybeSingle();

  if (lead?.id) {
    await supabase
      .from("contact_views")
      .insert({ lead_id: leadId, contractor_id: guard.user.id });
  }

  return NextResponse.json({ ok: true });
}
