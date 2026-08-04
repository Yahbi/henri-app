import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/* -------------------------------------------------------------------------- */
/*  Engagement Scoring Cron                                                   */
/*  Computes engagement scores for all active contractors and upserts them    */
/*  into the engagement_scores table. Also refreshes contractor stats.        */
/* -------------------------------------------------------------------------- */

/* ---- Scoring helpers ---- */

function loginScore(lastLogin: string | null): number {
  if (!lastLogin) return 0;
  const hoursAgo =
    (Date.now() - new Date(lastLogin).getTime()) / (1000 * 60 * 60);
  if (hoursAgo <= 24) return 25;
  if (hoursAgo <= 72) return 20;
  if (hoursAgo <= 168) return 15; // 7 days
  if (hoursAgo <= 336) return 10; // 14 days
  if (hoursAgo <= 720) return 5; // 30 days
  return 0;
}

function leadActionScore(actionCount: number): number {
  if (actionCount >= 11) return 25;
  if (actionCount >= 6) return 20;
  if (actionCount >= 3) return 15;
  if (actionCount >= 1) return 10;
  return 0;
}

function outreachScore(outreachCount: number): number {
  if (outreachCount >= 16) return 25;
  if (outreachCount >= 9) return 20;
  if (outreachCount >= 4) return 15;
  if (outreachCount >= 1) return 10;
  return 0;
}

function conversionScore(closeRate: number): number {
  if (closeRate >= 31) return 25;
  if (closeRate >= 21) return 20;
  if (closeRate >= 11) return 15;
  if (closeRate >= 1) return 10;
  return 0;
}

function deriveTier(total: number): string {
  if (total >= 90) return "platinum";
  if (total >= 75) return "gold";
  if (total >= 50) return "silver";
  return "bronze";
}

function deriveChurnRisk(
  total: number,
  lastLogin: string | null
): string {
  const daysAgo = lastLogin
    ? (Date.now() - new Date(lastLogin).getTime()) / (1000 * 60 * 60 * 24)
    : 999;

  if (total < 15 && daysAgo > 14) return "critical";
  if (total < 30 && daysAgo > 7) return "high";
  if (total < 50) return "medium";
  return "low";
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  try {
    /*
     * Audit fix 2026-05-02: this cron was 500-erroring with
     * "Failed to fetch contractors" because profiles has no
     * `last_login` column. Real login timestamps live in
     * auth.users.last_sign_in_at, which supabase-js can't join into
     * the public schema directly. Pulling them via a separate query
     * to auth.users (service-role can read it).
     *
     * Without this, the engagement_scores table stayed empty and the
     * data-health panel showed a permanent red chip.
     */
    const { data: contractorsRaw, error: cError } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "contractor")
      .eq("onboarding_completed", true);

    if (cError) {
      const detail = cError.message;
      logger.error("engagement.contractors-fetch-failed", { error: detail, code: cError.code });
      return NextResponse.json(
        { error: "Failed to fetch contractors", detail, code: cError.code },
        { status: 500 }
      );
    }

    // Fetch last_sign_in_at from auth.users for these contractor IDs.
    // Use admin.listUsers() since direct .from("auth.users") needs a
    // service-role grant beyond what the JS client bypass exposes.
    const lastLoginById = new Map<string, string | null>();
    try {
      const { data: usersRes } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      for (const u of usersRes?.users ?? []) {
        if (u.id) lastLoginById.set(u.id, u.last_sign_in_at ?? null);
      }
    } catch (e) {
      // Soft-fail — we still produce engagement scores, just with
      // login_score=0 for everyone. Better than blocking the cron.
      logger.warn("engagement.auth-listUsers-failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const contractors = (contractorsRaw ?? []).map((c) => ({
      id: c.id,
      last_login: lastLoginById.get(c.id) ?? null,
    }));

    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    let contractorsScored = 0;
    let totalScoreSum = 0;
    let churnCritical = 0;
    let churnHigh = 0;

    for (const contractor of contractors ?? []) {
      try {
        /* ---- Lead actions in last 30 days ---- */
        const { data: leads30d } = await supabase
          .from("leads")
          .select("id, status, won_at, pipeline_value")
          .eq("contractor_id", contractor.id)
          .gte("created_at", thirtyDaysAgo);

        const allLeads = leads30d ?? [];
        const leadsCount = allLeads.length;
        const actedOn = allLeads.filter((l) => l.status !== "new");
        const contactedLeads = allLeads.filter(
          (l) =>
            l.status === "contacted" ||
            l.status === "quoted" ||
            l.status === "proposal" ||
            l.status === "won" ||
            l.status === "lost"
        );
        const wonLeads = allLeads.filter((l) => l.status === "won");
        const revenue = wonLeads.reduce(
          (sum, l) => sum + (l.pipeline_value ?? 0),
          0
        );
        const closeRate =
          contactedLeads.length > 0
            ? Math.round((wonLeads.length / contactedLeads.length) * 100)
            : 0;

        /* ---- Outreach logs in last 30 days ---- */
        const { count: outreachCount } = await supabase
          .from("outreach_logs")
          .select("id", { count: "exact", head: true })
          .eq("contractor_id", contractor.id)
          .gte("created_at", thirtyDaysAgo);

        /* ---- Average response time (hours) ---- */
        const { data: responseTimes } = await supabase
          .from("leads")
          .select("created_at, contacted_at")
          .eq("contractor_id", contractor.id)
          .not("contacted_at", "is", null)
          .gte("created_at", thirtyDaysAgo);

        let avgResponseH = 0;
        if (responseTimes && responseTimes.length > 0) {
          const totalHours = responseTimes.reduce((sum, l) => {
            const created = new Date(l.created_at).getTime();
            const contacted = new Date(l.contacted_at).getTime();
            return sum + (contacted - created) / (1000 * 60 * 60);
          }, 0);
          avgResponseH = Math.round(totalHours / responseTimes.length);
        }

        /* ---- Compute scores ---- */
        const ls = loginScore(contractor.last_login);
        const las = leadActionScore(actedOn.length);
        const os = outreachScore(outreachCount ?? 0);
        const cs = conversionScore(closeRate);
        const totalScore = ls + las + os + cs;
        const tier = deriveTier(totalScore);
        const churnRisk = deriveChurnRisk(totalScore, contractor.last_login);

        /* ---- Upsert into engagement_scores ---- */
        const { error: upsertError } = await supabase
          .from("engagement_scores")
          .upsert(
            {
              contractor_id: contractor.id,
              login_score: ls,
              lead_action_score: las,
              outreach_score: os,
              conversion_score: cs,
              total_score: totalScore,
              tier,
              churn_risk: churnRisk,
              leads_30d: leadsCount,
              contacted_30d: contactedLeads.length,
              won_30d: wonLeads.length,
              revenue_30d: revenue,
              avg_response_h: avgResponseH,
              close_rate: closeRate,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "contractor_id" }
          );

        if (upsertError) {
          logger.error("Engagement upsert failed", { contractorId: contractor.id, error: String(upsertError) });
          continue;
        }

        /* ---- Refresh contractor stats via RPC ---- */
        await supabase.rpc("refresh_contractor_stats", {
          p_contractor_id: contractor.id,
        });

        contractorsScored++;
        totalScoreSum += totalScore;
        if (churnRisk === "critical") churnCritical++;
        if (churnRisk === "high") churnHigh++;
      } catch (err) {
        logger.error("Engagement scoring failed for contractor", { contractorId: contractor.id, error: String(err) });
      }
    }

    const avgScore =
      contractorsScored > 0
        ? Math.round(totalScoreSum / contractorsScored)
        : 0;

    return NextResponse.json({
      success: true,
      contractorsScored,
      avgScore,
      churnCritical,
      churnHigh,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Engagement cron error", { error: String(error) });
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
