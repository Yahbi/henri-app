import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logger } from "@/lib/logger";
import { isUuid } from "@/lib/validation/params";

/* Body is optional; when present the free-text field is capped so a
 * multi-MB payload can't be parked in the row. */
const BodySchema = z.object({
  reason: z.string().max(200).nullish(),
}).partial();

export const runtime = "nodejs";

/**
 * POST   /api/leads/[id]/hide   — hide the lead from the LeadsPanel
 * DELETE /api/leads/[id]/hide   — un-hide
 *
 * Module 11 of the 18-module enhancement plan.
 *
 * Hidden leads are filtered out of the default LeadsPanel view. A toggle
 * in the filter strip lets a contractor reveal hidden rows.
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const guard = await requireContractor(supabase);
  if (guard.response) return guard.response;

  const { id: leadId } = await ctx.params;
  if (!isUuid(leadId)) {
    return NextResponse.json({ error: "Malformed lead id" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(
    await req.json().catch(() => ({} as Record<string, unknown>)),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "reason must be a string of 200 characters or fewer" },
      { status: 400 },
    );
  }
  const reason = parsed.data.reason ?? null;

  const { error } = await supabase
    .from("hidden_leads")
    .upsert(
      { contractor_id: guard.user.id, lead_id: leadId, reason },
      { onConflict: "contractor_id,lead_id" },
    );
  if (error) {
    logger.error("leads.hide failed", { message: error.message });
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const guard = await requireContractor(supabase);
  if (guard.response) return guard.response;

  const { id: leadId } = await ctx.params;
  if (!isUuid(leadId)) {
    return NextResponse.json({ error: "Malformed lead id" }, { status: 400 });
  }

  const { error } = await supabase
    .from("hidden_leads")
    .delete()
    .eq("contractor_id", guard.user.id)
    .eq("lead_id", leadId);
  if (error) {
    logger.error("leads.hide failed", { message: error.message });
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
