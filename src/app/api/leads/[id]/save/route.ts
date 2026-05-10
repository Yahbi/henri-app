import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";

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
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const notes = typeof body?.notes === "string" ? body.notes.slice(0, 1000) : null;

  const { error } = await supabase
    .from("saved_leads")
    .upsert(
      { contractor_id: guard.user.id, lead_id: leadId, notes },
      { onConflict: "contractor_id,lead_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const guard = await requireContractor(supabase);
  if (guard.response) return guard.response;

  const { id: leadId } = await ctx.params;
  const { error } = await supabase
    .from("saved_leads")
    .delete()
    .eq("contractor_id", guard.user.id)
    .eq("lead_id", leadId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
