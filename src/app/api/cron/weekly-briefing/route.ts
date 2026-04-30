/**
 * /api/cron/weekly-briefing — Tier A+ Sprint 3 (A2 agent).
 *
 * Generates one weekly briefing per active contractor. Runs Mondays
 * 8am UTC per vercel.json. The briefing is a 3-4 sentence narrative
 * summarizing the contractor's territory: storm-impacted ZIPs, cascade
 * hotspots, stuck permits, hot leads.
 *
 * Tier A+ compliance:
 *   • Read-only — agent only reads aggregates the contractor already sees
 *   • No PII — aggregate counts only, never homeowner names
 *   • Service-role used to iterate contractors (no LLM call without budget
 *     check, which the orchestrator handles internally)
 *   • Each row written records the disclaimer-rendered flag
 *
 * Idempotent: the (contractor_id, period_start) unique index lets the cron
 * re-fire safely. Existing rows for the current week are kept (no overwrite)
 * so we don't run the LLM again if the cron is retried.
 *
 * Deadline-bounded to 280s (Vercel free tier hard ceiling is 300s).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  generateWeeklyBriefing,
  type WeeklyBriefingInput,
} from "@/lib/agents/weekly-briefing";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Snap a date to its ISO week's Monday (UTC). */
function isoWeekStart(d: Date): string {
  const day = d.getUTCDay() || 7; // Sunday → 7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const t0 = Date.now();
  const deadline = t0 + 280_000;
  const periodStart = isoWeekStart(new Date());
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let inserted = 0;
  let skipped_existing = 0;
  let skipped_quiet = 0;
  let errors_count = 0;
  const errors: string[] = [];

  /* ── Step 1: Pull active contractors. "Active" = has at least one lead
   * in the last 30 days, OR a profiles.role='contractor' marker. We use
   * the role check as the primary filter and let the briefing itself say
   * "quiet week" when aggregates are zero. */
  const { data: contractors, error: cErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "contractor")
    .limit(1000);
  if (cErr) {
    logger.error("weekly-briefing: profiles fetch failed", { error: cErr.message });
    return NextResponse.json({ error: "Profiles fetch failed" }, { status: 500 });
  }

  const contractorIds = (contractors ?? []).map((c) => c.id as string);

  /* ── Step 2: Per-contractor aggregation + LLM call. */
  for (const contractorId of contractorIds) {
    if (Date.now() > deadline) {
      logger.warn("weekly-briefing: deadline hit", {
        completed: inserted + skipped_existing + skipped_quiet,
        remaining: contractorIds.length - (inserted + skipped_existing + skipped_quiet),
      });
      break;
    }

    try {
      // Skip if a row already exists for this contractor this ISO week.
      const { data: existing } = await supabase
        .from("weekly_briefings")
        .select("id")
        .eq("contractor_id", contractorId)
        .eq("period_start", periodStart)
        .maybeSingle();

      if (existing) {
        skipped_existing++;
        continue;
      }

      // Aggregate stats for this contractor.
      const [
        leadsRes,
        hotLeadsRes,
        stormZipsRes,
        cascadeHotspotsRes,
        stuckPermitsRes,
        territoriesRes,
      ] = await Promise.all([
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("contractor_id", contractorId)
          .gte("created_at", sevenDaysAgo),
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("contractor_id", contractorId)
          .gte("score", 75)
          .gte("created_at", sevenDaysAgo),
        supabase
          .from("storm_predictions")
          .select("lead_id, leads!inner(contractor_id, zip)")
          .gte("storm_event_count_60d", 1)
          .limit(50),
        supabase
          .from("cascade_predictions")
          .select("lead_id, leads!inner(contractor_id, zip)")
          .gte("prob_90d", 0.4)
          .limit(50),
        supabase
          .from("permit_anomalies")
          .select("permit_id, permits!inner(zip), is_stuck")
          .eq("is_stuck", true)
          .limit(50),
        supabase
          .from("territories")
          .select("zip")
          .eq("contractor_id", contractorId)
          .limit(20),
      ]);

      // Count distinct ZIPs from each prediction set, scoped to the
      // contractor's territory.
      const territoryZips = new Set(
        (territoriesRes.data ?? []).map((t) => (t as { zip: string }).zip),
      );

      const stormZips = new Set<string>();
      for (const r of stormZipsRes.data ?? []) {
        const row = r as unknown as {
          leads: { contractor_id: string; zip: string | null } | null;
        };
        if (
          row.leads?.contractor_id === contractorId &&
          row.leads.zip &&
          territoryZips.has(row.leads.zip)
        ) {
          stormZips.add(row.leads.zip);
        }
      }

      const cascadeZips = new Set<string>();
      for (const r of cascadeHotspotsRes.data ?? []) {
        const row = r as unknown as {
          leads: { contractor_id: string; zip: string | null } | null;
        };
        if (
          row.leads?.contractor_id === contractorId &&
          row.leads.zip &&
          territoryZips.has(row.leads.zip)
        ) {
          cascadeZips.add(row.leads.zip);
        }
      }

      const stuckZips = new Set<string>();
      for (const r of stuckPermitsRes.data ?? []) {
        const row = r as unknown as { permits: { zip: string | null } | null };
        if (row.permits?.zip && territoryZips.has(row.permits.zip)) {
          stuckZips.add(row.permits.zip);
        }
      }

      const newLeadsCount = (leadsRes as { count: number | null }).count ?? 0;
      const hotLeadsCount = (hotLeadsRes as { count: number | null }).count ?? 0;

      /* ── Skip vacant accounts entirely — no point burning tokens on
       * "quiet week" briefings if the contractor has zero everything. */
      const totalSignal =
        newLeadsCount + hotLeadsCount + stormZips.size + cascadeZips.size + stuckZips.size;
      if (totalSignal === 0) {
        skipped_quiet++;
        continue;
      }

      const input: WeeklyBriefingInput = {
        contractorId,
        newLeadsCount,
        hotLeadsCount,
        stormImpactedZipsCount: stormZips.size,
        cascadeHotspotsCount: cascadeZips.size,
        stuckPermitsCount: stuckZips.size,
        topZips: Array.from(territoryZips).slice(0, 5),
        topTrades: [], // Future: pull from contractor licensed trades
      };

      const result = await generateWeeklyBriefing(supabase, input);
      if (!result.ok || !result.output) {
        errors_count++;
        errors.push(`${contractorId.slice(0, 8)}: ${result.errorCode ?? "no_output"}`);
        continue;
      }

      const { error: insErr } = await supabase
        .from("weekly_briefings")
        .insert({
          contractor_id: contractorId,
          output: result.output,
          aggregates: input as unknown as Record<string, unknown>,
          cost_usd: result.costUsd,
          tokens_in: result.tokensIn,
          tokens_out: result.tokensOut,
          model: "claude-3-5-sonnet-20241022",
          period_start: periodStart,
          generated_at: new Date().toISOString(),
          disclaimer_rendered: true,
        });

      if (insErr) {
        errors_count++;
        errors.push(`${contractorId.slice(0, 8)}: insert ${insErr.message}`);
      } else {
        inserted++;
      }
    } catch (e) {
      errors_count++;
      errors.push(
        `${contractorId.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const summary = {
    elapsed_ms: Date.now() - t0,
    period_start: periodStart,
    total_contractors: contractorIds.length,
    inserted,
    skipped_existing,
    skipped_quiet,
    errors_count,
    errors: errors.slice(0, 20), // Cap to avoid log bloat
  };
  logger.info("weekly-briefing complete", summary);
  return NextResponse.json({ success: errors_count === 0, summary });
}
