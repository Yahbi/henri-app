/**
 * POST /api/agents/lead-summary — Tier A+ Sprint 3 (A1 agent).
 *
 * On-demand 2-3 sentence narrative for the LeadDetailDrawer. Fetches the
 * lead + the 3 prediction caches with the contractor's RLS-enforced
 * Supabase client (so a contractor can never trigger a summary for a
 * lead they don't own), then runs the A1 agent.
 *
 * Tier A+ compliance:
 *   • Read-only — no writes other than the audit-log + budget update done
 *     by the orchestrator
 *   • Contractor-scoped via RLS
 *   • Body schema validated; user-supplied prompt content is impossible
 *     (the prompt is built server-side from DB rows)
 *   • FTC § 5 disclaimer rendered by the calling UI
 *
 * Cost: ~$0.001/call with Claude Haiku. Budget capped per-contractor by
 * the orchestrator (default 30k tokens/mo).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { LeadSummaryRequestSchema, parseBody } from "@/lib/schemas/api";
import { logApiError } from "@/lib/log";
import { generateLeadSummary } from "@/lib/agents/lead-summary";
import type { CascadePrediction } from "@/lib/predictive/cascade";
import type { StormPrediction } from "@/lib/predictive/storm-impact";
import type { PermitAnomaly } from "@/lib/predictive/anomaly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Auth before parse (2026-06-10): anonymous probes must not receive
    // schema-shaped validation errors.
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(LeadSummaryRequestSchema, raw);
    if (parsed.response) return parsed.response;
    const { lead_id: leadId } = parsed.data;

    /* ── Fetch the lead. RLS guarantees we only see the contractor's own
     * row; an unauthorized lead_id surfaces as a 404. */
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select(
        "id, address, zip, score, permit_type, permit_value, permit_filed_date, year_built, permit_id, contractor_id",
      )
      .eq("id", leadId)
      .single();
    if (leadErr || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    /* ── Fetch the 3 prediction caches in parallel. Each query is
     * RLS-protected (cascade_predictions / storm_predictions join
     * leads.contractor_id; permit_anomalies joins permits → leads). All
     * 3 graceful-degrade to empty when the migrations haven't been
     * applied yet. */
    const [cascadeRes, stormRes, anomalyRes] = await Promise.all([
      supabase
        .from("cascade_predictions")
        .select("predicted_trade, prob_90d, prob_180d, prob_365d, sample_size, confidence_label")
        .eq("lead_id", leadId)
        .order("prob_90d", { ascending: false })
        .limit(3),
      supabase
        .from("storm_predictions")
        .select(
          "storm_event_count_60d, last_storm_date, max_magnitude, primary_event_type, repair_likelihood_60d, repair_likelihood_90d, sample_size, confidence_label",
        )
        .eq("lead_id", leadId)
        .maybeSingle(),
      lead.permit_id
        ? supabase
            .from("permit_anomalies")
            .select(
              "jurisdiction_key, applied_to_issued_gap_days, jurisdiction_p95_gap_days, anomaly_score, is_stuck",
            )
            .eq("permit_id", lead.permit_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const cascade = (cascadeRes.data ?? []) as CascadePrediction[];
    const storm = (stormRes.data ?? null) as StormPrediction | null;
    const anomaly = (anomalyRes.data ?? null) as PermitAnomaly | null;

    /* ── Run the A1 agent. */
    const result = await generateLeadSummary(supabase, {
      contractorId: user.id,
      leadId,
      permitType: (lead.permit_type as string | null) ?? null,
      permitValue: (lead.permit_value as number | null) ?? null,
      yearBuilt: (lead.year_built as number | null) ?? null,
      address: (lead.address as string | null) ?? null,
      zip: (lead.zip as string | null) ?? null,
      appliedDate: (lead.permit_filed_date as string | null) ?? null,
      score: (lead.score as number | null) ?? null,
      cascade,
      storm,
      anomaly,
    });

    /* ── Return the orchestrator's full result (ok flag, output text,
     * cost, error code). The UI hook reads `output` and surfaces it; on
     * !ok it gracefully hides the panel. */
    return NextResponse.json({
      ok: result.ok,
      output: result.output,
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      errorCode: result.errorCode,
      // Never bubble up errorMessage to the client — it can leak info
      // about LLM provider state. The orchestrator's audit log captures it.
    });
  } catch (err) {
    logApiError("agents.lead-summary", err);
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 },
    );
  }
}
