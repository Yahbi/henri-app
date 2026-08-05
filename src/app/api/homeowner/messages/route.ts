import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { HomeownerMessageBodySchema, parseBody } from "@/lib/schemas/api";

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
 * POST → append `[in]:` line to the given lead's notes, via the
 *        `append_homeowner_message` RPC (migration 00121). Homeowners hold
 *        no UPDATE lane on `public.leads` — a direct write is filtered to
 *        zero rows and reported as success — so the RPC is the only path
 *        that actually lands, and it re-checks ownership itself.
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

    /* Error is destructured deliberately. `leads` carries no homeowner
     * SELECT lane until migration 00116 is applied, so this read returns an
     * empty set and every thread gets filtered out below — previously
     * surfacing as "No conversations yet" with HTTP 200, indistinguishable
     * from a homeowner who genuinely has no threads. Report the real state
     * instead of an empty one. */
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("id, notes, contractor_id")
      .in("id", leadIds);

    if (leadsErr) {
      logApiError("homeowner.messages.leads", leadsErr);
      return NextResponse.json({ error: "Failed to load threads" }, { status: 500 });
    }

    if ((leads ?? []).length === 0) {
      logApiError("homeowner.messages.leads_empty", {
        message:
          "matched intakes resolved to zero readable leads — homeowner SELECT lane on public.leads is missing (apply migration 00116_homeowner_write_lanes.sql)",
        leadIds: leadIds.length,
      });
      return NextResponse.json(
        { error: "Failed to load threads" },
        { status: 500 },
      );
    }

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

    const raw = await request.json().catch(() => ({}));
    const parsed = parseBody(HomeownerMessageBodySchema, raw);
    if (parsed.response) return parsed.response;
    const body = parsed.data;

    // Zod's min(1) admits a whitespace-only body, which the RPC then rejects.
    // Catch it here so it reads as the client error it is rather than a 500.
    const message = body.message.trim();
    if (!message) {
      return NextResponse.json({ error: "Message is empty" }, { status: 400 });
    }

    // Access gate — the homeowner must own an intake that matched this lead.
    // The RPC re-runs this same predicate as its own guard (it is SECURITY
    // DEFINER, so its check is the one that actually enforces access). This
    // read stays so an unauthorised send answers 403 instead of a generic
    // 500 from the raised exception.
    const { data: intake } = await supabase
      .from("homeowner_intakes")
      .select("id")
      .eq("contact_email", user.email)
      .eq("matched_lead_id", body.lead_id)
      .maybeSingle();

    if (!intake) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    /* The append runs entirely inside `append_homeowner_message` (00121).
     * Doing it here as SELECT-notes → build-line → UPDATE could not work:
     * `leads` has no homeowner UPDATE policy, so the write matched zero
     * rows and PostgREST returned success with no error — the send looked
     * fine and nothing was stored. The RPC also builds the line itself, so
     * a contractor message written between our read and our write can no
     * longer be clobbered, and it raises when the UPDATE touches no row
     * rather than returning quietly. Any error here is therefore a real
     * failure and is reported as one. */
    const { error: rpcErr } = await supabase.rpc("append_homeowner_message", {
      p_lead_id: body.lead_id,
      p_body: message,
    });

    if (rpcErr) {
      logApiError("homeowner.messages.post.rpc", rpcErr);
      // A missing function (migration 00121 unapplied) surfaces here too —
      // as a failure, which is the truth, not a silent success.
      return NextResponse.json({ error: "Send failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logApiError("homeowner.messages.post", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
