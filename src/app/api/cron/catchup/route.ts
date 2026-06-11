import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Catch-up orchestrator (2026-06-10 audit fix).
 *
 * The cron fleet (`.github/workflows/cron-fleet.yml`) dispatches a data cron
 * ONLY when GitHub happens to fire the fleet during that cron's exact :00/:30
 * slot. Under GH-Actions throttling a once-daily slot can be missed for days —
 * live audit found `openfema-ia`, `openfema-nfip`, `state-licenses-rotate`,
 * `gdelt-triggers`, and `activate-arcgis-sources` frozen since 2026-05-13,
 * which also stalled the ArcGIS coverage ramp.
 *
 * This endpoint runs every fleet fire and self-heals: for each tracked
 * data-ingest cron, it reads the latest `cron_runs` row and, if that's older
 * than the cron's cadence (or never ran), fires the cron server-to-server.
 * It's the same drain pattern as the score/enrich workflows but slot-agnostic.
 *
 * Scope is intentionally limited to IDEMPOTENT data-ingest crons — app-internal
 * crons with side effects (billing-sync, digests, follow-ups, review-requests)
 * stay on their exact slots so they never fire off-schedule.
 *
 * Bounded: fires at most MAX_FIRES most-overdue crons per invocation so a
 * single run can't blow the 300s budget; hourly invocation drains the rest.
 */

// cadence in hours — how stale a cron's last run may get before catch-up.
const CADENCE_H: Record<string, number> = {
  // daily ingest
  "openfema-ia": 24,
  "openfema-nfip": 24,
  "openfema-declarations": 24,
  "state-licenses-rotate": 24,
  "gdelt-triggers": 24,
  "activate-arcgis-sources": 24,
  "courtlistener-liens": 24,
  "usgs-quakes": 24,
  "swdi-events": 24,
  "census-geocode": 24,
  "storm-events": 24,
  // weekly ingest
  "fema-nri": 168,
  "hud-reo": 168,
};

const MAX_FIRES = 6;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const supabase = createAdminClient();
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://meethenri.com";

  // Latest successful-or-any run per tracked cron.
  const paths = Object.keys(CADENCE_H);
  const { data: runs } = await supabase
    .from("cron_runs")
    .select("cron_path, started_at")
    .in("cron_path", paths)
    .order("started_at", { ascending: false });

  const lastRun = new Map<string, number>();
  for (const r of (runs ?? []) as Array<{ cron_path: string; started_at: string }>) {
    if (!lastRun.has(r.cron_path)) {
      lastRun.set(r.cron_path, new Date(r.started_at).getTime());
    }
  }

  // Overdue = never ran, or last run older than cadence. Most-overdue first.
  const now = Date.now();
  const overdue = paths
    .map((p) => {
      const last = lastRun.get(p);
      const ageH = last == null ? Infinity : (now - last) / 3_600_000;
      return { path: p, ageH, overdueBy: ageH - CADENCE_H[p] };
    })
    .filter((c) => c.overdueBy > 0)
    .sort((a, b) => b.overdueBy - a.overdueBy)
    .slice(0, MAX_FIRES);

  const fired: Array<{ path: string; code: number; ageH: number }> = [];
  for (const c of overdue) {
    if (Date.now() - t0 > 250_000) break; // leave headroom under maxDuration
    let code = 0;
    try {
      const res = await fetch(`${base}/api/cron/${c.path}`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
        signal: AbortSignal.timeout(120_000),
      });
      code = res.status;
    } catch {
      code = 0; // timeout / network — will be retried next catch-up
    }
    fired.push({ path: c.path, code, ageH: Math.round(c.ageH) });
    logger.info("catchup fired cron", { path: c.path, code, ageH: Math.round(c.ageH) });
  }

  const summary = {
    tracked: paths.length,
    overdue: overdue.length,
    fired: fired.length,
    details: fired,
  };
  await logCronRun("catchup", t0, {
    pulled: overdue.length,
    inserted: fired.filter((f) => f.code === 200).length,
    summary,
    trigger: detectTrigger(request),
  });

  return NextResponse.json({ success: true, summary });
}
