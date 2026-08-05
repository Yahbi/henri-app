import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LeadNoteBodySchema, parseBody } from "@/lib/schemas/api";
import { logger } from "@/lib/logger";
import { requireContractor } from "@/lib/auth/requireContractor";
import { isUuid } from "@/lib/validation/params";

/* ── POST /api/leads/[id]/notes — append a timestamped note to a lead ── */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Malformed lead id" }, { status: 400 });
    }
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    const raw = await req.json();
    const parsed = parseBody(LeadNoteBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { content } = parsed.data;

    /* Reject pure-whitespace content (Zod's min(1) lets through "   "). */
    if (content.trim() === "") {
      return NextResponse.json(
        { error: "Note content required" },
        { status: 400 }
      );
    }

    /* Fetch the existing lead to get current notes */
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, contractor_id, notes")
      .eq("id", id)
      .eq("contractor_id", user.id)
      .single();

    if (leadErr || !lead) {
      return NextResponse.json(
        { error: "Lead not found or not yours" },
        { status: 404 }
      );
    }

    /* Build the timestamped note entry */
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${content.trim()}`;

    /* Append to existing notes (newline-separated) */
    const existingNotes = lead.notes?.trim() ?? "";
    const updatedNotes = existingNotes
      ? `${existingNotes}\n${entry}`
      : entry;

    /* Update the lead's notes field */
    const { data: updated, error: updateErr } = await supabase
      .from("leads")
      .update({ notes: updatedNotes })
      .eq("id", id)
      .eq("contractor_id", user.id)
      .select("id, notes")
      .single();

    if (updateErr) {
      logger.error("Note update error", { error: updateErr instanceof Error ? updateErr.message : String(updateErr) });
      return NextResponse.json(
        { error: "Failed to save note" },
        { status: 500 }
      );
    }

    /* Create an audit notification so the activity timeline picks it up */
    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "note_added",
      title: "Note added to lead",
      body: content.trim().length > 120
        ? `${content.trim().slice(0, 117)}...`
        : content.trim(),
      read: true,
      metadata: { lead_id: id },
    });

    return NextResponse.json(
      {
        success: true,
        notes: updated?.notes ?? updatedNotes,
        timestamp,
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error("Lead notes POST error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
