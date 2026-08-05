import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LeadPatchBodySchema, parseBody } from "@/lib/schemas/api";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logger } from "@/lib/logger";
import { isUuid } from "@/lib/validation/params";

/* GET /api/leads/[id] — fetch single lead with permit data */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Malformed lead id" }, { status: 400 });
  }

  const supabase = await createClient();
  const gate = await requireContractor(supabase);
  if (gate.response) return gate.response;
  const user = gate.user;

  const { data, error } = await supabase
    .from("leads")
    .select(`*, permits!inner(*)`)
    .eq("id", id)
    .eq("contractor_id", user.id)
    .single();

  if (error) {
    logger.error("leads.get failed", { message: error.message });
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

/* PATCH /api/leads/[id] — update lead status, notes, etc. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Malformed lead id" }, { status: 400 });
  }

  const supabase = await createClient();
  const gate = await requireContractor(supabase);
  if (gate.response) return gate.response;
  const user = gate.user;

  const raw = await req.json().catch(() => null);
  const parsed = parseBody(LeadPatchBodySchema, raw);
  if (parsed.response) return parsed.response;

  /* Strict schema → drop undefined keys so untouched columns stay put. */
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) updates[key] = value;
  }

  /* Auto-set timestamps on status transitions */
  if (updates.status === "contacted" && !updates.contacted_at) {
    updates.contacted_at = new Date().toISOString();
  }
  if (updates.status === "won" && !updates.won_at) {
    updates.won_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", id)
    .eq("contractor_id", user.id)
    .select()
    .single();

  if (error) {
    logger.error("leads.patch failed", { message: error.message });
    return NextResponse.json({ error: "Failed to update lead" }, { status: 400 });
  }
  return NextResponse.json(data);
}
