import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classify as classifyIntent } from "@/lib/intent/classify";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Phase AA-3 / Option A — pre-intent synthesis cron.
 *
 * Walks each active contractor's claimed ZIPs, fetches the
 * parcels_sidecar rows in those ZIPs, runs the intent classifier on
 * each parcel, and INSERTs synthetic leads when ≥3 pre-intent reason
 * codes fire. Pairs with migration 00094 (`leads.source` column +
 * `parcel_sidecar_uid` pointer + `(contractor_id, parcel_sidecar_uid)`
 * unique index for upsert safety).
 *
 * Architectural goals:
 *   1. Preserve ZIP exclusivity — parcels are only synthesised into
 *      the contractor's claimed ZIPs. No cross-territory bleed.
 *   2. Bounded volume — capped at 50 inserts per (contractor, ZIP)
 *      per run to avoid flooding the LeadsPanel with cold leads.
 *   3. Honest provenance — every synthesised lead lands with
 *      source='parcel_synthesis' so the UI can label it as a
 *      pre-intent signal, not a permit-backed opportunity.
 *   4. Idempotent — the partial unique index on
 *      (contractor_id, parcel_sidecar_uid) makes re-runs safe; an
 *      existing parcel-derived lead for the same (contractor, parcel)
 *      pair is updated in place rather than duplicated.
 *
 * Today's coverage: parcels_sidecar has data for 7 dead-permit
 * states (ME/MS/NH/OK/RI/UT/WV) — those are exactly the territories
 * where pre-intent has the most wedge value (no permit pipeline to
 * draw from). As parcels_sidecar expands to more states this cron
 * automatically extends with it.
 */

const PER_CONTRACTOR_PER_ZIP_CAP = 50;
const PRE_INTENT_MIN_REASON_CODES = 3;

async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const summary = {
    contractors_walked: 0,
    parcels_classified: 0,
    pre_intent_matches: 0,
    leads_inserted: 0,
    leads_updated: 0,
    errors: 0,
    by_state: {} as Record<string, number>,
  };

  try {
    const supabase = createAdminClient();

    // ── 1. Active contractors with ≥1 active territory ─────────────
    const { data: territoryRows, error: territoryErr } = await supabase
      .from("territories")
      .select("contractor_id, zip")
      .eq("status", "active");

    if (territoryErr) {
      logger.error("synthesize-pre-intent.territory_query_failed", { error: territoryErr.message });
      return NextResponse.json({ error: "Failed to load territories" }, { status: 500 });
    }

    // Group ZIPs by contractor.
    const contractorZips = new Map<string, Set<string>>();
    for (const t of territoryRows ?? []) {
      if (!t.contractor_id || !t.zip) continue;
      const set = contractorZips.get(t.contractor_id) ?? new Set<string>();
      set.add(t.zip);
      contractorZips.set(t.contractor_id, set);
    }

    if (contractorZips.size === 0) {
      logger.info("synthesize-pre-intent.no_contractors");
      await logCronRun("api/cron/synthesize-pre-intent", startedAt, {
        status: "ok",
        trigger: detectTrigger(request),
        inserted: summary.leads_inserted,
        summary,
      });
      return NextResponse.json({ success: true, ...summary });
    }

    // ── 2. Per-contractor: walk claimed ZIPs in parcels_sidecar ────
    for (const [contractorId, zipSet] of contractorZips.entries()) {
      summary.contractors_walked += 1;
      const claimedZips = Array.from(zipSet);

      // Pull parcels in any of this contractor's claimed ZIPs that
      // have at least the minimum metadata to attempt classification
      // (we need year_built or built_year, lot/sqft, or last sale —
      // truly empty rows can't generate pre-intent codes).
      const { data: parcels, error: parcelsErr } = await supabase
        .from("parcels_sidecar")
        .select(
          "sidecar_uid, state_code, source_parcel_id, situs_addr, situs_city, situs_zip, owner_name, owner_mailing_addr, recent_transfer_at, total_appraisal, building_appraisal, land_appraisal, built_year, building_sqft, land_use, occupancy_desc, resident_phone",
        )
        .in("situs_zip", claimedZips)
        .not("situs_zip", "is", null)
        .limit(claimedZips.length * PER_CONTRACTOR_PER_ZIP_CAP * 4); // headroom — only ~25% will pass the threshold

      if (parcelsErr) {
        logger.warn("synthesize-pre-intent.parcels_query_failed", {
          contractorId,
          error: parcelsErr.message,
        });
        summary.errors += 1;
        continue;
      }
      if (!parcels || parcels.length === 0) continue;

      // Per-zip cap counter for fairness: if a contractor has 5 ZIPs
      // we don't want one ZIP to consume the whole budget.
      const perZipInserted = new Map<string, number>();

      // ── 3. Classify each parcel ─────────────────────────────────
      const inserts: Array<Record<string, unknown>> = [];

      for (const p of parcels) {
        summary.parcels_classified += 1;

        const zip = p.situs_zip as string;
        if ((perZipInserted.get(zip) ?? 0) >= PER_CONTRACTOR_PER_ZIP_CAP) continue;

        // Project parcel row → ClassifyInput shape.
        // owner_name "investor patterns" (LLC/INC/TRUST) are detected
        // inside the classifier; we just pass the raw owner_name.
        const classified = classifyIntent({
          permit_status: null,           // by definition this parcel has no permit
          permit_type: null,
          permit_description: null,
          year_built: (p.built_year as number | null) ?? null,
          home_sqft: (p.building_sqft as number | null) ?? null,
          assessed_value: (p.total_appraisal as number | null) ?? null,
          property_value: (p.total_appraisal as number | null) ?? null,
          owner_name: (p.owner_name as string | null) ?? null,
          mailing_address: (p.owner_mailing_addr as string | null) ?? null,
          situs_address: (p.situs_addr as string | null) ?? null,
          // recent_transfer_at is a date — convert to days_since_sale
          days_since_sale: p.recent_transfer_at
            ? Math.max(
                0,
                Math.floor(
                  (Date.now() - new Date(p.recent_transfer_at as string).getTime()) /
                    86_400_000,
                ),
              )
            : null,
          is_homeowner_intake: false,
          phone: (p.resident_phone as string | null) ?? null,
        });

        // Only synthesise when classifier emitted pre_intent stage AND
        // at least the minimum number of reason codes fired. The
        // classifier already requires ≥3 codes for pre_intent, but we
        // gate again here to allow the threshold to be tuned without
        // re-deploying the classifier.
        if (
          classified.stage !== "pre_intent" ||
          classified.reason_codes.length < PRE_INTENT_MIN_REASON_CODES
        ) {
          continue;
        }

        summary.pre_intent_matches += 1;
        perZipInserted.set(zip, (perZipInserted.get(zip) ?? 0) + 1);
        summary.by_state[p.state_code as string] =
          (summary.by_state[p.state_code as string] ?? 0) + 1;

        // Build the synthetic lead row. Several columns are
        // intentionally NULL — there's no permit, no permit_value, no
        // permit_age. Score is fixed at a conservative 30 (cool tier)
        // so synthesised leads don't crowd hot permit-derived leads
        // in the LeadsPanel sort.
        inserts.push({
          contractor_id: contractorId,
          source: "parcel_synthesis",
          parcel_sidecar_uid: p.sidecar_uid,
          permit_id: null,
          opportunity_stage: "pre_intent",
          reason_codes: classified.reason_codes,
          trade_tags: classified.trade_tags ?? [],
          status: "new",
          urgency: "cool",
          score: 30,
          score_model: "parcel_synthesis_v1",
          score_reasoning: `Pre-intent signal from parcel record: ${classified.reason_codes.slice(0, 3).join(", ")}`,
          address: p.situs_addr,
          city: p.situs_city,
          state: p.state_code,
          zip,
          owner_name: p.owner_name,
          phone: p.resident_phone,
          year_built: p.built_year,
          home_sqft: p.building_sqft,
          assessed_value: p.total_appraisal,
          notes: `Parcel record: ${p.source_parcel_id}`,
        });
      }

      if (inserts.length === 0) continue;

      // ── 4. Bulk upsert via the (contractor_id, parcel_sidecar_uid)
      //       partial unique index. Existing rows get updated in place;
      //       new rows are inserted.
      const { data: result, error: upsertErr } = await supabase
        .from("leads")
        .upsert(inserts, {
          onConflict: "contractor_id,parcel_sidecar_uid",
          ignoreDuplicates: false,
        })
        .select("id");

      if (upsertErr) {
        logger.warn("synthesize-pre-intent.upsert_failed", {
          contractorId,
          attempted: inserts.length,
          error: upsertErr.message,
        });
        summary.errors += 1;
        continue;
      }

      summary.leads_inserted += result?.length ?? 0;
      logger.info("synthesize-pre-intent.contractor_done", {
        contractorId,
        zips: claimedZips.length,
        synthesised: result?.length ?? 0,
      });
    }

    await logCronRun("api/cron/synthesize-pre-intent", startedAt, {
      status: "ok",
      trigger: detectTrigger(request),
      inserted: summary.leads_inserted,
      summary,
    });

    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    logger.error("synthesize-pre-intent.fatal", {
      error: err instanceof Error ? err.message : String(err),
    });
    await logCronRun("api/cron/synthesize-pre-intent", startedAt, {
      status: "error",
      trigger: detectTrigger(request),
      summary,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
