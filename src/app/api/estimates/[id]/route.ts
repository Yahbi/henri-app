import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEstimateEmail } from "@/lib/resend/estimate-email";
import { hasResend } from "@/lib/env";
import { EstimatePatchBodySchema, parseBody } from "@/lib/schemas/api";
import { logger } from "@/lib/logger";

/* ─── GET /api/estimates/[id] — single estimate detail ─── */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: estimate, error } = await supabase
      .from("quotes")
      .select("id, contractor_id, homeowner_id, trade, zip, description, amount, status, tiers, contact_name, contact_email, contact_phone, scope_notes, viewed_at, sent_at, created_at, updated_at")
      .eq("id", id)
      .single();

    if (error || !estimate) {
      return NextResponse.json(
        { error: "Estimate not found" },
        { status: 404 }
      );
    }

    /* Verify the user is the contractor or the homeowner */
    if (
      estimate.contractor_id !== user.id &&
      estimate.homeowner_id !== user.id
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    /* Update viewed_at when the homeowner first views the estimate */
    if (estimate.homeowner_id === user.id && !estimate.viewed_at) {
      await supabase
        .from("quotes")
        .update({ viewed_at: new Date().toISOString() })
        .eq("id", id);

      estimate.viewed_at = new Date().toISOString();
    }

    return NextResponse.json({ estimate });
  } catch (err) {
    logger.error("Estimate GET error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── PATCH /api/estimates/[id] — contractor updates an estimate ─── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Fetch the existing estimate — must belong to this contractor */
    const { data: existing, error: fetchErr } = await supabase
      .from("quotes")
      .select("id, contractor_id, contact_name, contact_email, trade, zip, description, amount, scope_notes")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { error: "Estimate not found" },
        { status: 404 }
      );
    }

    if (existing.contractor_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const raw = await req.json();
    const parsed = parseBody(EstimatePatchBodySchema, raw);
    if (parsed.response) return parsed.response;

    /* The schema is strict + every field optional, so `parsed.data`
     * is already a tight whitelist. Drop undefined keys before sending
     * to Supabase so we don't accidentally null-out untouched fields. */
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    /* Send estimate email via Resend when status changes to "sent" */
    if (updates.status === "sent" && hasResend()) {
      const email = (updates.contact_email as string) ?? existing.contact_email;
      if (email) {
        await sendEstimateEmail({
          contactName: existing.contact_name ?? "Homeowner",
          contactEmail: email,
          trade: existing.trade ?? "General",
          zip: existing.zip ?? "",
          description: existing.description ?? undefined,
          amount: existing.amount ?? 0,
          scopeNotes: existing.scope_notes ?? undefined,
          estimateId: id,
        });
      }
    }

    const { data: updated, error: updateErr } = await supabase
      .from("quotes")
      .update(updates)
      .eq("id", id)
      .select("id, contractor_id, homeowner_id, trade, zip, description, amount, status, tiers, contact_name, contact_email, contact_phone, scope_notes, viewed_at, sent_at, created_at, updated_at")
      .single();

    if (updateErr) {
      logger.error("Estimate update error", { error: updateErr instanceof Error ? updateErr.message : String(updateErr) });
      return NextResponse.json(
        { error: "Failed to update estimate" },
        { status: 500 }
      );
    }

    return NextResponse.json({ estimate: updated });
  } catch (err) {
    logger.error("Estimate PATCH error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
