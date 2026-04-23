import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* ── POST /api/leads/[id]/notes — append a timestamped note to a lead ── */

export async function POST(
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

    const body = await req.json();
    const { content } = body as { content?: string };

    if (!content || content.trim() === "") {
      return NextResponse.json(
        { error: "content is required" },
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
      console.error("Note update error:", updateErr);
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
    console.error("Lead notes POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
