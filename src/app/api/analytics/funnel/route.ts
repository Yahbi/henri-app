import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/* Ordered funnel stages (the happy path) */
const FUNNEL_STAGES = ["new", "contacted", "quoted", "proposal", "won"] as const;

/**
 * Compute average days between two date arrays (pairwise).
 * Only includes pairs where both dates exist and target > source.
 */
function avgDaysBetween(
  sources: (string | null)[],
  targets: (string | null)[]
): number | null {
  let total = 0;
  let count = 0;

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const t = targets[i];
    if (!s || !t) continue;

    const diff = new Date(t).getTime() - new Date(s).getTime();
    if (diff > 0) {
      total += diff;
      count++;
    }
  }

  if (count === 0) return null;
  return Math.round(total / count / 86_400_000 * 10) / 10; /* 1 decimal */
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Fetch leads from the last 30 days */
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, status, created_at, contacted_at, won_at")
      .eq("contractor_id", user.id)
      .gte("created_at", thirtyDaysAgo.toISOString());

    if (leadsError) throw leadsError;

    const allLeads = leads ?? [];
    const totalLeads = allLeads.length;

    /* Count leads by status */
    const statusCounts: Record<string, number> = {
      new: 0,
      contacted: 0,
      quoted: 0,
      proposal: 0,
      won: 0,
      lost: 0,
    };

    for (const lead of allLeads) {
      const status = (lead.status as string) ?? "new";
      if (status in statusCounts) {
        statusCounts[status]++;
      }
    }

    /*
     * For funnel analysis, count leads that REACHED each stage.
     * A lead at "won" also passed through new, contacted, quoted, proposal.
     * We use the ordered index: if a lead's current status index >= stage index,
     * it reached that stage.
     */
    const stageIndex: Record<string, number> = {};
    FUNNEL_STAGES.forEach((s, i) => {
      stageIndex[s] = i;
    });
    /* Lost leads count at whichever stage they were at before being lost.
       We can't determine that precisely from status alone, so we count them
       as having reached "new" at minimum. For funnel stages we only count
       active progression. */

    const reachedCounts: Record<string, number> = {};
    for (const stage of FUNNEL_STAGES) {
      reachedCounts[stage] = 0;
    }

    for (const lead of allLeads) {
      const status = (lead.status as string) ?? "new";
      const idx = stageIndex[status] ?? -1;

      if (idx >= 0) {
        /* Lead is on the happy path -- count it for all stages up to current */
        for (let i = 0; i <= idx; i++) {
          reachedCounts[FUNNEL_STAGES[i]]++;
        }
      } else if (status === "lost") {
        /* Lost leads at least reached "new" */
        reachedCounts["new"]++;
      }
    }

    /* ── Build funnel stages with conversion rates ── */
    const stages = FUNNEL_STAGES.map((name, i) => {
      const count = reachedCounts[name];
      const previousCount = i === 0 ? totalLeads : reachedCounts[FUNNEL_STAGES[i - 1]];
      const rate = previousCount > 0 ? Math.round((count / previousCount) * 1000) / 10 : 0;

      return { name, count, rate };
    });

    /* ── Average time between stages ── */
    /* created_at -> contacted_at */
    const createdDates = allLeads.map((l: Record<string, unknown>) => l.created_at as string | null);
    const contactedDates = allLeads.map((l: Record<string, unknown>) => l.contacted_at as string | null);
    const wonDates = allLeads.map((l: Record<string, unknown>) => l.won_at as string | null);

    const avgCreatedToContacted = avgDaysBetween(createdDates, contactedDates);

    /*
     * For contacted->quoted and quoted->proposal we don't have dedicated timestamp
     * columns, so we report null. The won_at field lets us measure contacted->won
     * and overall cycle time.
     */
    const avgContactedToWon = avgDaysBetween(contactedDates, wonDates);
    const avgCreatedToWon = avgDaysBetween(createdDates, wonDates);

    /* Attach avgDays to each stage transition */
    const stagesWithTiming = stages.map((s, i) => {
      let avgDays: number | null = null;

      if (i === 1) {
        /* new -> contacted */
        avgDays = avgCreatedToContacted;
      }
      /* Stages 2 and 3 (quoted, proposal) lack dedicated timestamps */

      return { ...s, avgDays };
    });

    /* ── Drop-off rates ── */
    const stagesWithDropoff = stagesWithTiming.map((s, i) => {
      const previousCount = i === 0 ? totalLeads : stages[i - 1].count;
      const dropoff =
        previousCount > 0
          ? Math.round(((previousCount - s.count) / previousCount) * 1000) / 10
          : 0;
      return { ...s, dropoff };
    });

    /* ── Overall metrics ── */
    const totalWon = statusCounts.won;
    const conversionRate =
      totalLeads > 0
        ? Math.round((totalWon / totalLeads) * 1000) / 10
        : 0;

    return NextResponse.json(
      {
        stages: stagesWithDropoff,
        overall: {
          totalLeads,
          totalWon,
          totalLost: statusCounts.lost,
          conversionRate,
          avgCycleDays: avgCreatedToWon,
          avgContactDays: avgCreatedToContacted,
          avgCloseFromContactDays: avgContactedToWon,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logger.error("Funnel API error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to compute funnel data" },
      { status: 500 }
    );
  }
}
