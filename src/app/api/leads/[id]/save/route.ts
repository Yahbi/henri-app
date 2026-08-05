import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logger } from "@/lib/logger";
import { isUuid } from "@/lib/validation/params";

/* Body is optional; when present the free-text field is capped so a
 * multi-MB payload can't be parked in the row. */
const BodySchema = z.object({
  notes: z.string().max(1000).nullish(),
}).partial();

export const runtime = "nodejs";

/**
 * POST   /api/leads/[id]/save   — save the lead to saved_leads
 * DELETE /api/leads/[id]/save   — un-save
 *
 * Module 11 of the 18-module enhancement plan (2026-05-09 plan §9.13.D).
 *
 * RLS on `saved_leads` already enforces self-write; this route exists to
 * provide a clean API surface + return JSON for the UI button toggle.
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
      { error: "notes must be a string of 1000 characters or fewer" },
      { status: 400 },
    );
  }
  const notes = parsed.data.notes ?? null;

  const { error } = await supabase
    .from("saved_leads")
    .upsert(
      { contractor_id: guard.user.id, lead_id: leadId, notes },
      { onConflict: "contractor_id,lead_id" },
    );
  if (error) {
    logger.error("leads.save failed", { message: error.message });
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
    .from("saved_leads")
    .delete()
    .eq("contractor_id", guard.user.id)
    .eq("lead_id", leadId);
  if (error) {
    logger.error("leads.save failed", { message: error.message });
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
