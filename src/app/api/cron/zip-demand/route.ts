import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/* -------------------------------------------------------------------------- */
/*  ZIP Demand Scoring Cron                                                   */
/*  Computes demand scores for every ZIP with recent permit activity, then    */
/*  upserts results into zip_demand_scores and refreshes the leaderboard.    */
/* -------------------------------------------------------------------------- */

function computeDemandScore(params: {
  permits30d: number;
  trendPct: number;
  avgValue: number;
  contractorDensity: number;
}): number {
  /* Weighted formula:
   *   40% permits volume (log scale, capped)
   *   20% trend (positive trend increases score)
   *   20% avg project value (log scale)
   *   20% inverse contractor density (less competition = higher score)
   */
  const volumeScore = Math.min(
    40,
    Math.round((Math.log10(params.permits30d + 1) / Math.log10(200)) * 40)
  );

  const trendScore = Math.min(
    20,
    Math.max(0, Math.round(10 + (params.trendPct / 100) * 10))
  );

  const valueScore = Math.min(
    20,
    params.avgValue > 0
      ? Math.round(
          (Math.log10(params.avgValue) / Math.log10(5_000_000)) * 20
        )
      : 0
  );

  const densityScore =
    params.contractorDensity === 0
      ? 20
      : Math.max(0, Math.round(20 - params.contractorDensity * 4));

  return Math.min(100, Math.max(0, volumeScore + trendScore + valueScore + densityScore));
}

function deriveCompetitionLevel(density: number): string {
  if (density <= 1) return "low";
  if (density === 2) return "medium";
  if (density === 3) return "high";
  return "saturated";
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  try {
    const now = Date.now();
    /*
     * 2026-05-02 fix: send DATE-only strings (YYYY-MM-DD) instead of
     * full ISO timestamps. The permits.issued_date column is type
     * `date`, not `timestamp`. Sending a timestamp forces PostgREST
     * to cast at query time, and the planner can't always prove the
     * cast is constant — it falls back to a seq scan on the 1.4M-row
     * table and hits the 60s statement timeout. Date-only strings let
     * the existing idx_permits_issued_date btree range-scan directly.
     */
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    /* -------------------------------------------------------------------- */
    /*  Fetch all permits from the last 60 days, grouped by ZIP             */
    /* -------------------------------------------------------------------- */

    /*
     * Audit fix 2026-05-02: this cron has been silently 500-erroring since
     * at least 2026-04-26 because the SELECT referenced a non-existent
     * column `filed_date`. The permits table uses `applied_date` /
     * `issued_date` / `approved_date` / `completed_date`. The 500 error
     * left zip_demand_scores empty, which forced every lead's
     * "ZIP demand" signal to default to 8/15 — capping every lead's
     * total score in the 30-69 band and producing 0 hot leads (≥75)
     * across 177k production rows.
     *
     * Switching to `applied_date` (the closest equivalent to "filed").
     * Fall back to `issued_date` when applied_date is null via COALESCE
     * at the row mapper level below.
     */
    /*
     * 2026-05-02: switched filter from applied_date to issued_date.
     * >98% of permits in production have applied_date=NULL (only
     * 19,911 of 1.4M rows). issued_date is filled on 1.0M permits
     * AND has a btree index (idx_permits_issued_date). An OR across
     * both columns forces a seq-scan on a 1.4M-row table and times
     * out the Supabase 60s statement budget; using issued_date alone
     * is index-sargable and returns in <500ms.
     *
     * 30-day window (was 60d) keeps the working set tight without
     * losing demand-signal accuracy — older permits don't reflect
     * current ZIP demand.
     */
    const { data: recentPermits, error: permitError } = await supabase
      .from("permits")
      .select("zip, estimated_value, permit_type, applied_date, issued_date")
      .gte("issued_date", thirtyDaysAgo)
      .not("zip", "is", null)
      .order("issued_date", { ascending: false })
      .limit(50_000); // safety cap; 50k rows = ~6MB JSON

    if (permitError) {
      logger.error("zip-demand.permit-fetch-failed", {
        error: String(permitError),
        message: permitError.message,
        details: permitError.details,
        hint: permitError.hint,
        code: permitError.code,
      });
      return NextResponse.json(
        {
          error: "Failed to fetch permits",
          // Surface the supabase error to the response body so the
          // admin trigger / cron_runs audit log shows the real cause
          // instead of a generic 500.
          detail: permitError.message,
          code: permitError.code,
        },
        { status: 500 }
      );
    }

    if (!recentPermits || recentPermits.length === 0) {
      return NextResponse.json({
        success: true,
        zipsScored: 0,
        avgDemandScore: 0,
        hottestZip: null,
        timestamp: new Date().toISOString(),
      });
    }

    /* Group permits by ZIP */
    const zipPermits = new Map<
      string,
      Array<{
        estimated_value: number | null;
        permit_type: string | null;
        filed_date: string;
      }>
    >();

    for (const permit of recentPermits) {
      if (!permit.zip) continue;
      // Coalesce applied_date → issued_date so permits without applied_date
      // (some scraped jurisdictions only populate issued_date) still
      // contribute to the demand calc.
      const filedDate = permit.applied_date ?? permit.issued_date;
      if (!filedDate) continue;
      const list = zipPermits.get(permit.zip) ?? [];
      list.push({
        estimated_value: permit.estimated_value,
        permit_type: permit.permit_type,
        filed_date: filedDate,
      });
      zipPermits.set(permit.zip, list);
    }

    /* -------------------------------------------------------------------- */
    /*  Fetch active territory counts per ZIP                               */
    /* -------------------------------------------------------------------- */

    const allZips = [...zipPermits.keys()];

    const { data: territories } = await supabase
      .from("territories")
      .select("zip")
      .in("zip", allZips)
      .eq("status", "active");

    const zipContractorCount = new Map<string, number>();
    for (const t of territories ?? []) {
      zipContractorCount.set(
        t.zip,
        (zipContractorCount.get(t.zip) ?? 0) + 1
      );
    }

    /* -------------------------------------------------------------------- */
    /*  Compute scores per ZIP                                              */
    /* -------------------------------------------------------------------- */

    let zipsScored = 0;
    let totalDemand = 0;
    let hottestZip: string | null = null;
    let hottestScore = -1;

    const upsertRows: Array<Record<string, unknown>> = [];

    for (const [zip, permits] of zipPermits) {
      const current30d = permits.filter(
        (p) => new Date(p.filed_date) >= new Date(thirtyDaysAgo)
      );
      const prior30d = permits.filter(
        (p) =>
          new Date(p.filed_date) < new Date(thirtyDaysAgo) &&
          new Date(p.filed_date) >= new Date(sixtyDaysAgo)
      );

      const permits30d = current30d.length;
      const permitsPrior = prior30d.length;
      const trendPct =
        permitsPrior > 0
          ? Math.round(((permits30d - permitsPrior) / permitsPrior) * 100)
          : permits30d > 0
            ? 100
            : 0;

      const valuesWithData = current30d
        .map((p) => p.estimated_value)
        .filter((v): v is number => v != null && v > 0);
      const avgProjectValue =
        valuesWithData.length > 0
          ? Math.round(
              valuesWithData.reduce((a, b) => a + b, 0) /
                valuesWithData.length
            )
          : 0;

      const contractorDensity = zipContractorCount.get(zip) ?? 0;

      const demandScore = computeDemandScore({
        permits30d,
        trendPct,
        avgValue: avgProjectValue,
        contractorDensity,
      });

      const competitionLevel = deriveCompetitionLevel(contractorDensity);

      /* Determine top trade by frequency */
      const tradeCounts = new Map<string, number>();
      for (const p of current30d) {
        const t = p.permit_type ?? "Unknown";
        tradeCounts.set(t, (tradeCounts.get(t) ?? 0) + 1);
      }
      let topTrade = "Unknown";
      let topTradeCount = 0;
      for (const [trade, count] of tradeCounts) {
        if (count > topTradeCount) {
          topTrade = trade;
          topTradeCount = count;
        }
      }

      upsertRows.push({
        zip,
        permits_30d: permits30d,
        permits_trend_pct: trendPct,
        avg_project_value: avgProjectValue,
        contractor_density: contractorDensity,
        demand_score: demandScore,
        competition_level: competitionLevel,
        top_trade: topTrade,
        // Schema uses `computed_at`, not `updated_at`. Audit 2026-05-02
        // — earlier code path tried to write a column that doesn't
        // exist and would have errored on every batch even after the
        // SELECT was fixed.
        computed_at: new Date().toISOString(),
      });

      zipsScored++;
      totalDemand += demandScore;

      if (demandScore > hottestScore) {
        hottestScore = demandScore;
        hottestZip = zip;
      }
    }

    /* -------------------------------------------------------------------- */
    /*  Upsert all rows in batches                                          */
    /* -------------------------------------------------------------------- */

    const BATCH_SIZE = 500;
    for (let i = 0; i < upsertRows.length; i += BATCH_SIZE) {
      const batch = upsertRows.slice(i, i + BATCH_SIZE);
      const { error: upsertError } = await supabase
        .from("zip_demand_scores")
        .upsert(batch, { onConflict: "zip" });

      if (upsertError) {
        logger.error("ZIP demand upsert error", { error: String(upsertError) });
      }
    }

    /* -------------------------------------------------------------------- */
    /*  Refresh the contractor leaderboard materialized view                */
    /* -------------------------------------------------------------------- */

    const { error: refreshError } = await supabase.rpc(
      "refresh_contractor_leaderboard"
    );

    if (refreshError) {
      logger.error("Failed to refresh contractor_leaderboard", { error: String(refreshError) });
    }

    const avgDemandScore =
      zipsScored > 0 ? Math.round(totalDemand / zipsScored) : 0;

    return NextResponse.json({
      success: true,
      zipsScored,
      avgDemandScore,
      hottestZip,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("ZIP demand cron error", { error: String(error) });
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
