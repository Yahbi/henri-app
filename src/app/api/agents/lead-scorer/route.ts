import { NextRequest, NextResponse } from "next/server";
import { buildSignals, calculateScore } from "@/lib/scoring/model";
import { fetchLivePermits } from "@/lib/permits/live";
import { LeadScorerBodySchema, parseBody } from "@/lib/schemas/api";
import { logger } from "@/lib/logger";

/**
 * Lead Scorer Agent
 *
 * POST /api/agents/lead-scorer
 * Body: { lead_ids?: string[] }
 *
 * Re-scores leads using the full scoring engine with enriched data.
 * If no lead_ids provided, scores all leads from the live pipeline.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = parseBody(LeadScorerBodySchema, raw);
    if (parsed.response) return parsed.response;
    const requestedIds = parsed.data.lead_ids;

    let leads = await fetchLivePermits();

    // Filter to requested IDs if provided
    if (requestedIds?.length) {
      const idSet = new Set(requestedIds);
      leads = leads.filter((l) => idSet.has(l.id));
    }

    // Re-score each lead with the full scoring engine
    const scored = leads.map((lead) => {
      const signals = buildSignals({
        permit: {
          issue_date: lead.permit_filed_date,
          estimated_value: lead.permit_value,
          description: lead.permit_description,
          permit_type: lead.permit_type,
          zip: lead.zip,
          created_at: lead.created_at,
        },
        lead: {
          phone: lead.phone,
          email: lead.email,
          owner_name: lead.owner_name,
          owner_first: lead.owner_first,
          owner_last: lead.owner_last,
          owner_occupied: lead.owner_occupied,
          property_value: lead.property_value,
          assessed_value: lead.assessed_value,
          is_homeowner_intake: lead.is_homeowner_intake,
          permit_description: lead.permit_description,
          trade: lead.trade,
          created_at: lead.created_at,
        },
      });

      const result = calculateScore(signals);

      return {
        id: lead.id,
        previous_score: lead.score,
        new_score: result.total,
        urgency: result.urgency,
        components: {
          freshness: result.freshness,
          value: result.value,
          contact: result.contact,
          demand: result.demand,
          engagement: result.engagement,
          conversion: result.conversion,
        },
        factors: result.factors,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.new_score - a.new_score);

    return NextResponse.json({
      status: "ok",
      scored_count: scored.length,
      leads: scored,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[lead-scorer] Error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { status: "error", message: "Scoring failed" },
      { status: 500 },
    );
  }
}
