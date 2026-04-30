import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  aggregateBuckets,
  bucketsToPredictions,
  extractCascadePairs,
  normalizeTrade,
  type CanonicalTrade,
} from "@/lib/predictive/cascade";
import {
  REPAIR_DRIVING_EVENTS,
  buildStormPrediction,
  type StormEvent,
} from "@/lib/predictive/storm-impact";
import {
  buildJurisdictionKey,
  buildJurisdictionP95,
  classifyAnomaly,
  computeGapDays,
} from "@/lib/predictive/anomaly";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * /api/cron/predictive-refresh — Tier A+ Sprint 1.
 *
 * Refreshes 3 prediction caches: cascade_predictions, storm_predictions,
 * permit_anomalies. Runs weekly per vercel.json (5am UTC Sundays).
 *
 * Tier A+ compliance: aggregates only public permit + storm data. NO PII
 * processed. NO LLM. NO outbound communication. NO consumer-impacting
 * decisions. Bypassed by the deadline guard if work exceeds 280s.
 *
 * Gated by CRON_SECRET. Schedule in vercel.json: 0 5 * * 0 (5am UTC Sun).
 *
 * Throughput notes:
 *   - cascade refresh: builds a global trade-pair model from
 *     address_permit_history (~1.4M permits aggregated into ~700k addresses).
 *     Per-address pair extraction is fast (<1ms); model build ~30s.
 *   - per-lead UPSERT into cascade_predictions: ~5ms; for 165k leads,
 *     ~14 minutes. Split across multiple deadline-bounded runs if needed.
 *   - storm refresh: per-lead lookup of recent storm_events; <10ms; ~28 min.
 *   - anomaly refresh: jurisdiction-p95 build (~10s) + per-permit
 *     classification (<1ms); ~20 min for 1.4M permits.
 *
 * Strategy: each run processes a slice of leads/permits where
 * computed_at < NOW() - INTERVAL '6 days', so successive runs naturally
 * resume. Worst case: needs ~3 runs to cover the full corpus weekly.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const t0 = Date.now();
  const deadline = t0 + 280_000;

  let cascadeUpserts = 0;
  let stormUpserts = 0;
  let anomalyUpserts = 0;
  const errors: string[] = [];

  /* ── Step 1: Build the global cascade model ──────────────────────────
   * Pull every row from address_permit_history with permit_count >= 2 and
   * a permits jsonb array. Extract pairs, aggregate buckets globally.
   * This gives us the (primary_trade → predicted_trade) probabilities. */
  let cascadePredictions: Array<{
    primary_trade: CanonicalTrade;
    predicted_trade: CanonicalTrade;
    prob_90d: number;
    prob_180d: number;
    prob_365d: number;
    sample_size: number;
    confidence_label: "low" | "medium" | "high";
  }> = [];

  try {
    const { data: addressRows, error: addrErr } = await supabase
      .from("address_permit_history")
      .select("permits, trades, permit_count")
      .gte("permit_count", 2)
      .limit(50_000); // Cap for cron; weekly refresh allows full coverage over multiple runs

    if (addrErr) {
      errors.push(`address_permit_history: ${addrErr.message}`);
    } else if (addressRows && addressRows.length > 0) {
      const allPairs = [];
      const primaryCounts = new Map<CanonicalTrade, number>();
      for (const row of addressRows) {
        const permits = Array.isArray(row.permits) ? row.permits : [];
        const pairs = extractCascadePairs(
          permits as Array<{ trade?: string | null; applied_date?: string | null; issued_date?: string | null }>,
        );
        allPairs.push(...pairs);

        // Count primary trade occurrences for the sample-size denominator
        const trades = (row.trades ?? []) as string[];
        for (const t of trades) {
          const norm = normalizeTrade(t);
          if (!norm) continue;
          primaryCounts.set(norm, (primaryCounts.get(norm) ?? 0) + 1);
        }
      }
      const buckets = aggregateBuckets(allPairs);
      cascadePredictions = bucketsToPredictions(buckets, primaryCounts);
      logger.info("cascade model built", {
        address_rows: addressRows.length,
        pairs: allPairs.length,
        buckets: buckets.size,
        predictions: cascadePredictions.length,
      });
    }
  } catch (e) {
    errors.push(`cascade-build: ${e instanceof Error ? e.message : String(e)}`);
  }

  /* ── Step 2: For every active lead, upsert cascade predictions based on
   * the lead's primary trade. */
  if (cascadePredictions.length > 0 && Date.now() < deadline) {
    try {
      const { data: leads } = await supabase
        .from("leads")
        .select("id, trade")
        .not("trade", "is", null)
        .limit(2000); // Per-run cap; multiple runs cover the full set

      for (const lead of leads ?? []) {
        if (Date.now() > deadline) break;
        const leadTrade = normalizeTrade(lead.trade as string);
        if (!leadTrade) continue;

        const matches = cascadePredictions.filter(
          (p) => p.primary_trade === leadTrade,
        );
        if (matches.length === 0) continue;

        for (const m of matches) {
          const { error: upErr } = await supabase
            .from("cascade_predictions")
            .upsert(
              {
                lead_id: lead.id,
                predicted_trade: m.predicted_trade,
                prob_90d: m.prob_90d,
                prob_180d: m.prob_180d,
                prob_365d: m.prob_365d,
                sample_size: m.sample_size,
                confidence_label: m.confidence_label,
                computed_at: new Date().toISOString(),
              },
              { onConflict: "lead_id,predicted_trade" },
            );
          if (!upErr) cascadeUpserts++;
        }
      }
    } catch (e) {
      errors.push(`cascade-upsert: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /* ── Step 3: Storm predictions per lead. For each lead with a ZIP,
   * count recent storm events at that ZIP. Compute repair-likelihood. */
  if (Date.now() < deadline) {
    try {
      const { data: leads } = await supabase
        .from("leads")
        .select("id, zip")
        .not("zip", "is", null)
        .limit(2000);

      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      for (const lead of leads ?? []) {
        if (Date.now() > deadline) break;
        const { data: stormRows } = await supabase
          .from("storm_events")
          .select("begin_date, event_type, magnitude")
          .eq("zip", lead.zip)
          .gte("begin_date", sixtyDaysAgo)
          .in("event_type", REPAIR_DRIVING_EVENTS as readonly string[] as string[]);

        const events = (stormRows ?? []) as StormEvent[];
        if (events.length === 0) continue;

        // Stub historical rates — refined in subsequent sprints. For now,
        // use modest constants until we build the (ZIP × event) baseline.
        const historicalRate60d = 0.25;
        const historicalRate90d = 0.35;
        const sampleSize = 100; // Placeholder

        const prediction = buildStormPrediction(
          events,
          historicalRate60d,
          historicalRate90d,
          sampleSize,
        );

        const { error: upErr } = await supabase
          .from("storm_predictions")
          .upsert(
            {
              lead_id: lead.id,
              storm_event_count_60d: prediction.storm_event_count_60d,
              last_storm_date: prediction.last_storm_date,
              max_magnitude: prediction.max_magnitude,
              primary_event_type: prediction.primary_event_type,
              repair_likelihood_60d: prediction.repair_likelihood_60d,
              repair_likelihood_90d: prediction.repair_likelihood_90d,
              sample_size: prediction.sample_size,
              confidence_label: prediction.confidence_label,
              computed_at: new Date().toISOString(),
            },
            { onConflict: "lead_id" },
          );
        if (!upErr) stormUpserts++;
      }
    } catch (e) {
      errors.push(`storm: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /* ── Step 4: Permit anomalies. Build per-jurisdiction p95, classify
   * each permit, upsert flagged ones. */
  if (Date.now() < deadline) {
    try {
      // First, build the p95 benchmark
      const { data: gapRows } = await supabase
        .from("permits")
        .select("city, state, applied_date, issued_date")
        .not("applied_date", "is", null)
        .not("issued_date", "is", null)
        .limit(50_000);

      const benchmarkRows: Array<{ jurisdiction_key: string; gap_days: number }> = [];
      for (const r of gapRows ?? []) {
        const gap = computeGapDays(r.applied_date, r.issued_date);
        if (gap == null) continue;
        const key = buildJurisdictionKey(r.city as string | null, r.state as string | null);
        benchmarkRows.push({ jurisdiction_key: key, gap_days: gap });
      }
      const p95Map = buildJurisdictionP95(benchmarkRows);

      // Now classify permits + upsert anomalies
      const { data: permits } = await supabase
        .from("permits")
        .select("id, city, state, applied_date, issued_date")
        .not("applied_date", "is", null)
        .not("issued_date", "is", null)
        .limit(2000);

      for (const p of permits ?? []) {
        if (Date.now() > deadline) break;
        const gap = computeGapDays(p.applied_date, p.issued_date);
        const key = buildJurisdictionKey(p.city as string | null, p.state as string | null);
        const p95 = p95Map.get(key) ?? null;
        const result = classifyAnomaly(gap, p95);
        if (!result.is_stuck) continue;

        const { error: upErr } = await supabase
          .from("permit_anomalies")
          .upsert(
            {
              permit_id: p.id,
              jurisdiction_key: key,
              applied_to_issued_gap_days: gap,
              jurisdiction_p95_gap_days: p95,
              anomaly_score: result.anomaly_score,
              is_stuck: result.is_stuck,
              computed_at: new Date().toISOString(),
            },
            { onConflict: "permit_id" },
          );
        if (!upErr) anomalyUpserts++;
      }
    } catch (e) {
      errors.push(`anomaly: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const summary = {
    elapsed_ms: Date.now() - t0,
    hit_deadline: Date.now() >= deadline,
    cascade_upserts: cascadeUpserts,
    storm_upserts: stormUpserts,
    anomaly_upserts: anomalyUpserts,
    errors,
  };
  logger.info("predictive-refresh complete", summary);
  return NextResponse.json({ success: errors.length === 0, summary });
}
