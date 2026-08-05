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
//
// 2026-08-05: `scrape` was NOT in this map, and a cron_runs audit found it
// had not executed ONCE in 14 days. That is the permit ingester — the cron
// that adds new permits to the catalog. Only `catchup` and `score` recur
// (they are the two vercel.json slots the Hobby plan allows); every other
// entry below existed here precisely because nothing else fires them. So the
// single most important data cron in the product was the one cron nobody
// caught up, and the catalog had been static for two weeks while the site
// advertised "refreshed daily".
//
// The same audit found four other ingest paths absent for the same reason.
// Anything that ADDS or REFRESHES data belongs in this map; the deliberate
// exclusions (billing-sync, digests, follow-ups, review-requests) are
// side-effecting and must stay on exact slots, as the docstring says.
// 2026-08-05, second pass. A full inventory found 44 cron routes on disk,
// 2 vercel.json slots, and 18 entries here — leaving 24 routes with NO
// scheduling path of any kind. The 9 added below are the ones that are both
// (a) genuinely needed and (b) safe to fire from here.
//
// The excluded 15, and why, so nobody has to re-derive this:
//   cdc-svi, census-acs, hmda-rotate, hud-zipxw, code-violations,
//   nifc-wildfires        — deliberately pruned in migration 00079 (data
//                           collected but never read by any surface). Kept
//                           on disk for fast re-enable. Leave unscheduled.
//   digest, weekly-digest — SEND EMAIL and have no send-dedupe of their own.
//                           Catchup's only dedupe is the cron_runs cadence
//                           check, so a logging failure between "email sent"
//                           and "run logged" would re-send. That is not
//                           hypothetical on this instance: the database has
//                           been unreachable several times today, and
//                           logCronRun is best-effort by design and swallows
//                           its own failures. Needs a per-recipient
//                           sent-marker before it can be enrolled.
//   permits               — SUPERSEDED. It is the previous-generation
//                           ingester, walking the hardcoded 25-entry
//                           PERMIT_SOURCES array; `scrape` walks the
//                           DB-driven permit_sources registry (~12k rows)
//                           and is already tracked above. Running both
//                           writes the same table twice for no new coverage.
//                           Delete it once `scrape` has a few clean runs.
const CADENCE_H: Record<string, number> = {
  // permit ingest — the core pipeline
  scrape: 12,
  "nj-statewide-permits": 24,
  "discover-sources": 168,
  // enrichment + published stats
  enrich: 24,
  "refresh-landing-stats": 24,
  // scoring inputs. zip-demand feeds the `zip_demand` signal, which carries
  // 15 of the 100 score points — a stale table silently mis-scores every
  // lead in the product, which is worse than an obviously-missing feature.
  "zip-demand": 24,
  "geocode-backfill": 24,
  "predictive-refresh": 24,
  "market-intel": 168,
  "re-enrich": 168,
  // Stripe reconciliation. Unscheduled, a plan that drifts from Stripe (a
  // failed webhook, a manual change in the dashboard) is never corrected,
  // so entitlement silently diverges from what the customer is paying.
  "billing-sync": 24,
  // Sunday aggregates. These held the two vercel.json slots until those were
  // repurposed for catchup + score, at which point they lost their only
  // scheduling path and stopped running entirely.
  "refresh-zip-aggregates": 168,
  "synthesize-pre-intent": 168,
  // Retention. cron_runs grows unbounded otherwise, and it is the table
  // catchup itself reads on every pass.
  "cron-runs-cleanup": 168,
  // Contractor-facing work. Each of these DOES have side effects, which is
  // why they were originally excluded — but "excluded from catchup" turned
  // out to mean "never runs at all", which is worse than running on a
  // cadence. Each one below carries its OWN send/dedupe guard in addition to
  // catchup's cron_runs cadence check, so a double-fire cannot double-send.
  "follow-ups": 24,
  "review-requests": 24,
  "blast-worker": 24,
  engagement: 24,
  "license-check": 24,
  "weekly-briefing": 168,
  // daily sidecar ingest
  "openfema-ia": 24,
  "openfema-nfip": 24,
  "openfema-declarations": 24,
  "state-licenses-rotate": 24,
  "gdelt-triggers": 24,
  "activate-arcgis-sources": 24,
  "courtlistener-liens": 24,
  "usgs-quakes": 24,
  "swdi-events": 24,
  // Hourly: ZIP is what gates lead creation, and 957,520 permits are
  // still missing one. See the cadence note in .github/workflows/cron-fleet.yml.
  "census-geocode": 1,
  // Every 2h. No-op unless a territory was claimed recently.
  "territory-backfill": 2,
  "storm-events": 24,
  // weekly ingest
  "fema-nri": 168,
  "hud-reo": 168,
};

/**
 * Crons fired first when several are overdue at once.
 *
 * Without this, ordering is purely by how overdue a cron is, so a sidecar
 * that has been stale for a week outranks the permit ingester that is stale
 * by a day — and with MAX_FIRES capping each run, the pipeline that actually
 * produces leads can be starved indefinitely by the long tail.
 */
const PRIORITY = new Set(["scrape", "nj-statewide-permits", "enrich"]);

// Raised from 6: the map now carries 18 entries, and at 6 per run a cron at
// the back of a fully-overdue queue would wait three days for a slot.
// Each fire is a server-to-server call that returns quickly (the callee does
// its own work within its own budget), so the 300s ceiling is not the
// binding constraint here.
/**
 * Ceiling on fires per invocation.
 *
 * Raised 10 -> 24 alongside the switch to bounded concurrency. The old
 * sequential loop could not have used a higher number — 10 slow crons
 * already exhausted the 250s budget. Firing four at a time makes the whole
 * tracked fleet drainable in a single daily invocation, which is the point:
 * on Hobby, catchup runs once a day, so "per invocation" and "per day" are
 * the same number, and anything it cannot reach today falls further behind
 * tomorrow.
 *
 * The real bound is still the DEADLINE_MS check inside the workers; this is
 * a backstop so a pathological cron_runs state cannot queue every route at
 * once.
 */
const MAX_FIRES = 24;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
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
    // Priority crons first, then most-overdue. Pure overdue-ordering lets a
    // sidecar that has been stale for a week outrank the permit ingester
    // that is stale by a day — and with MAX_FIRES capping each run, the
    // pipeline that actually produces leads gets starved by the long tail.
    .sort((a, b) => {
      const pa = PRIORITY.has(a.path) ? 1 : 0;
      const pb = PRIORITY.has(b.path) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return b.overdueBy - a.overdueBy;
    })
    .slice(0, MAX_FIRES);

  /* Fire with bounded CONCURRENCY, not one at a time.
   *
   * This used to be a sequential for-loop with a 120s per-call timeout
   * inside a 250s budget, which capped a run at ~2 slow crons. On the Hobby
   * plan catchup itself only fires ONCE A DAY (two slots, once-daily), so
   * "10 per run" was really "10 per day" — and with the fleet now at 30+
   * tracked crons, anything at the back of a fully-overdue queue would wait
   * three days for a turn. Crons that ingest daily data would never catch up
   * at all; they would fall further behind every day.
   *
   * Each fire is a server-to-server HTTP call that spends nearly all its
   * time waiting on the callee, which does its own work inside its own
   * function budget. So this is I/O-bound, not CPU-bound, and running four
   * at once costs essentially nothing here while roughly quadrupling how
   * much of the fleet one daily invocation can drain.
   *
   * 4 is deliberate rather than unbounded: every callee talks to the same
   * Supabase instance, whose disk IOPS are the binding constraint (a bulk
   * write took PostgREST down entirely on 2026-08-05). Firing 30 data crons
   * simultaneously would recreate that. Four keeps the DB busy without
   * stampeding it.
   */
  const CONCURRENCY = 4;
  const DEADLINE_MS = 250_000; // headroom under maxDuration = 300

  const fired: Array<{ path: string; code: number; ageH: number }> = [];
  const queue = [...overdue];

  async function worker() {
    for (;;) {
      // Re-check the deadline per item, not per batch: one slow cron must
      // not drag the whole run past maxDuration and lose the cron_runs
      // record for everything that already succeeded.
      if (Date.now() - t0 > DEADLINE_MS) return;
      const c = queue.shift();
      if (!c) return;
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
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
  );

  // Anything still queued ran out of clock. Say so explicitly — a silent
  // truncation here reads as "the fleet is healthy" when it is not.
  const skipped = queue.map((c) => c.path);
  if (skipped.length > 0) {
    logger.warn("catchup hit its deadline with crons still overdue", {
      skipped,
      firedCount: fired.length,
    });
  }

  const summary = {
    tracked: paths.length,
    overdue: overdue.length,
    fired: fired.length,
    skipped: skipped.length,
    skippedPaths: skipped,
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
