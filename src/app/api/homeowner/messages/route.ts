import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";

/**
 * Homeowner-side message thread endpoint.
 *
 * Reuses the contractor's `leads.notes` column as the conversation store —
 * same `[out]: ` / `[in]: ` line format used by
 * `src/app/(dashboard)/dashboard/messages/page.tsx`. That keeps the two
 * sides of the conversation in one place and avoids a second schema.
 *
 * GET  → list every lead derived from an intake this homeowner submitted,
 *        with the lead's notes and matched contractor display info.
 * POST → append `[in]:` line to the given lead's notes. Access is gated to
 *        the homeowner who owns the intake that produced that lead.
 */

type HomeownerThread = {
  lead_id: string;
  intake_id: string;
  contractor_id: string;
  contractor_name: string;
  trade: string;
  zip: string;
  status: string;
  created_at: string;
  notes: string | null;
};

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Pull all intakes by this homeowner that were successfully matched.
    const { data: intakes, error: intakeErr } = await supabase
      .from("homeowner_intakes")
      .select(
        "id, trade, zip, status, created_at, matched_lead_id, matched_contractor_id",
      )
      .eq("contact_email", user.email)
      .not("matched_lead_id", "is", null)
      .order("created_at", { ascending: false });

    if (intakeErr) {
      logApiError("homeowner.messages.intakes", intakeErr);
      return NextResponse.json({ error: "Failed to load threads" }, { status: 500 });
    }

    const leadIds = (intakes ?? [])
      .map((i) => i.matched_lead_id)
      .filter((v): v is string => !!v);

    if (leadIds.length === 0) {
      return NextResponse.json({ threads: [] });
    }

    const { data: leads } = await supabase
      .from("leads")
      .select("id, notes, contractor_id")
      .in("id", leadIds);

    // Contractor display names from the profiles table.
    const contractorIds = Array.from(
      new Set((leads ?? []).map((l) => l.contractor_id).filter(Boolean)),
    ) as string[];

    const { data: contractors } = contractorIds.length
      ? await supabase
          .from("profiles")
          .select("id, company_name, full_name")
          .in("id", contractorIds)
      : { data: [] };

    const cMap = new Map<string, { company_name: string | null; full_name: string | null }>();
    for (const c of contractors ?? []) {
      cMap.set(c.id, { company_name: c.company_name, full_name: c.full_name });
    }
    const leadMap = new Map<string, { notes: string | null; contractor_id: string }>();
    for (const l of leads ?? []) {
      leadMap.set(l.id, { notes: l.notes, contractor_id: l.contractor_id });
    }

    const threads: HomeownerThread[] = (intakes ?? [])
      .filter((i) => i.matched_lead_id && leadMap.has(i.matched_lead_id))
      .map((i) => {
        const lead = leadMap.get(i.matched_lead_id as string)!;
        const c = cMap.get(lead.contractor_id) ?? {
          company_name: null,
          full_name: null,
        };
        return {
          lead_id: i.matched_lead_id as string,
          intake_id: i.id,
          contractor_id: lead.contractor_id,
          contractor_name: c.company_name ?? c.full_name ?? "Your contractor",
          trade: i.trade,
          zip: i.zip,
          status: i.status,
          created_at: i.created_at,
          notes: lead.notes,
        };
      });

    return NextResponse.json({ threads });
  } catch (err) {
    logApiError("homeowner.messages.get", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      lead_id?: string;
      message?: string;
    };

    if (!body.lead_id || !body.message?.trim()) {
      return NextResponse.json(
        { error: "lead_id and message are required" },
        { status: 400 },
      );
    }

    // Access gate — the homeowner must own an intake that matched this lead.
    const { data: intake } = await supabase
      .from("homeowner_intakes")
      .select("id")
      .eq("contact_email", user.email)
      .eq("matched_lead_id", body.lead_id)
      .maybeSingle();

    if (!intake) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Read existing notes, append a new inbound line, write back.
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("notes")
      .eq("id", body.lead_id)
      .single();

    if (leadErr || !lead) {
      logApiError("homeowner.messages.post.readLead", leadErr);
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const timestamp = new Date().toISOString();
    const newLine = `${timestamp} [in]: ${body.message.trim()}`;
    const nextNotes = lead.notes ? `${lead.notes}\n${newLine}` : newLine;

    const { error: updateErr } = await supabase
      .from("leads")
      .update({ notes: nextNotes, updated_at: timestamp })
      .eq("id", body.lead_id);

    if (updateErr) {
      logApiError("homeowner.messages.post.update", updateErr);
      return NextResponse.json({ error: "Send failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logApiError("homeowner.messages.post", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
