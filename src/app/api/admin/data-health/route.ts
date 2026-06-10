/**
 * GET /api/admin/data-health
 *
 * God-mode-only data-health survey for the canonical-data-layer.
 * Returns one row per sidecar table with:
 *   - total_rows (count(*))
 *   - last_ingested_at (max(ingested_at) where present)
 *   - last_24h (count rows ingested in the last 24h — proxy for "is the
 *     cron firing?")
 *   - schedule (the cron schedule that populates the table)
 *   - cron_path (the route slug under /api/cron/)
 *
 * Powers the admin UI at /dashboard/settings/data-health. Catches
 * silent-rot — a cron whose endpoint moves or whose token expires
 * stops inserting; this surfaces the gap before it festers.
 *
 * No mutation. Service-role queries (small `count` per table). The
 * count(*) on the largest tables (HMDA can be tens of millions when
 * fully back-filled) is bound by Supabase's exact-count timeout —
 * we use `head: true` + `count: estimated` for those.
 *
 * Auth: god-mode email allowlist via `isGodModeEmail()` — same pattern
 * as `/api/dev/is-god-mode`.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGodModeEmail } from "@/lib/auth/god-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TableSpec {
  table: string;
  cron_path: string;
  schedule: string;
  /** Wave label: 1 / 1.5 / 2.A / 2.B.1 / 2.B.2 */
  wave: string;
  description: string;
  /** When false, count(*) uses estimated mode (skips the exact scan). */
  exact_count: boolean;
}

/*
 * 2026-05-02 retrospective audit pruned 6 tables/crons whose data
 * never reached the contractor surface (drawer, scoring, outreach):
 *   svi_tracts        (cdc-svi)         — CDC dataset deprecated
 *   demo_acs_zcta     (census-acs)      — never read in src/
 *   mortgages_hmda    (hmda-rotate)     — 2 rows after weeks of rotation
 *   zip_crosswalk_hud (hud-zipxw)       — HUD requires authenticated login
 *   code_violations   (code-violations) — drawer panel not built yet
 *   wildfires_nifc    (nifc-wildfires)  — drawer panel not built yet
 * Routes still exist on disk; just unscheduled and removed from the
 * data-health panel so the freshness UI stops showing red chips for
 * empty/dead tables. See plan retrospective in
 * ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */
const TABLES: TableSpec[] = [
  // Wave 1
  { table: "weather_swdi_hail",     cron_path: "swdi-events",          schedule: "0 23 * * *",  wave: "1",     description: "NOAA SWDI hail signatures (7d window)",         exact_count: false },
  { table: "weather_swdi_wind",     cron_path: "swdi-events",          schedule: "0 23 * * *",  wave: "1",     description: "NOAA SWDI wind/mesocyclone signatures (7d)",     exact_count: false },
  { table: "weather_swdi_tornado",  cron_path: "swdi-events",          schedule: "0 23 * * *",  wave: "1",     description: "NOAA SWDI tornado vortex signatures (7d)",       exact_count: false },
  { table: "liens_courtlistener",   cron_path: "courtlistener-liens",  schedule: "30 16 * * *", wave: "1",     description: "CourtListener mechanic-lien dockets (30d)",      exact_count: true  },
  { table: "quakes_usgs",           cron_path: "usgs-quakes",          schedule: "0 17 * * *",  wave: "1",     description: "USGS earthquakes M2.5+ (7d, CONUS+AK)",          exact_count: true  },
  { table: "foreclosures_fha",      cron_path: "hud-reo",              schedule: "0 18 * * 0",  wave: "1",     description: "HUD FHA REO foreclosures (full)",                exact_count: true  },
  // Wave 2.A — kept only NRI county/tract; svi_tracts + demo_acs_zcta pruned
  { table: "risk_nri_county",       cron_path: "fema-nri",             schedule: "0 20 * * 0",  wave: "2.A",   description: "FEMA National Risk Index — counties (~3k)",      exact_count: true  },
  { table: "risk_nri_tract",        cron_path: "fema-nri",             schedule: "0 20 * * 0",  wave: "2.A",   description: "FEMA National Risk Index — tracts (~84k)",       exact_count: true  },
  // Wave 2.B Phase 1 — mortgages_hmda pruned (starved)
  { table: "claims_disasters_fema", cron_path: "openfema-declarations",schedule: "0 22 * * *",  wave: "2.B.1", description: "FEMA disaster declarations (~70k)",              exact_count: true  },
  { table: "triggers_news_gdelt",   cron_path: "gdelt-triggers",       schedule: "30 22 * * *", wave: "2.B.1", description: "GDELT construction-trigger news (7d)",           exact_count: true  },
  // Wave 2.B Phase 2 — zip_crosswalk_hud pruned (auth blocker)
  { table: "claims_nfip",           cron_path: "openfema-nfip",        schedule: "30 23 * * *", wave: "2.B.2", description: "FEMA NFIP redacted claims (year rotator)",       exact_count: false },
  { table: "claims_ia",             cron_path: "openfema-ia",          schedule: "0 0 * * *",   wave: "2.B.2", description: "FEMA IA valid registrations (disaster rot.)",    exact_count: false },
  { table: "state_license_rosters", cron_path: "state-licenses-rotate",schedule: "30 0 * * *",  wave: "2.B.2", description: "Public state contractor license rosters (rot.)",exact_count: true  },
  // Wave 2.C pruned entirely — code_violations + wildfires_nifc had no
  // drawer / scoring consumer at the time of the audit.
];

interface CronRunInfo {
  started_at: string;
  duration_ms: number | null;
  status: "ok" | "error" | "partial";
  inserted: number | null;
  error: string | null;
  trigger: "cron" | "manual";
}

interface HealthRow {
  table: string;
  cron_path: string;
  schedule: string;
  wave: string;
  description: string;
  total_rows: number | null;
  last_ingested_at: string | null;
  last_24h: number | null;
  status: "ok" | "stale" | "empty" | "error";
  /** Last 5 entries from cron_runs (audit log added migration 00076).
   *  Empty when migration not applied or this cron isn't yet wrapped. */
  recent_runs: CronRunInfo[];
}

const STALE_HOURS = 48;

async function probeTable(spec: TableSpec): Promise<HealthRow> {
  const supabase = createAdminClient();
  let totalRows: number | null = null;
  let lastIngested: string | null = null;
  let last24h: number | null = null;
  let status: HealthRow["status"] = "ok";
  let recentRuns: CronRunInfo[] = [];

  try {
    // Total row count
    const totalRes = await supabase
      .from(spec.table)
      .select("*", { count: spec.exact_count ? "exact" : "estimated", head: true });
    if (totalRes.error) {
      return {
        table: spec.table,
        cron_path: spec.cron_path,
        schedule: spec.schedule,
        wave: spec.wave,
        description: spec.description,
        total_rows: null,
        last_ingested_at: null,
        last_24h: null,
        status: "error",
        recent_runs: [],
      };
    }
    totalRows = totalRes.count ?? 0;

    // Last ingested timestamp + 24h count + last 5 cron_runs in parallel.
    const [ingestRes, dayRes, runsRes] = await Promise.all([
      supabase
        .from(spec.table)
        .select("ingested_at")
        .order("ingested_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from(spec.table)
        .select("*", { count: "estimated", head: true })
        .gte("ingested_at", new Date(Date.now() - 86_400_000).toISOString()),
      // cron_runs is migration 00076 — graceful-degrade when missing.
      supabase
        .from("cron_runs")
        .select("started_at, duration_ms, status, inserted, error, trigger")
        .eq("cron_path", spec.cron_path)
        .order("started_at", { ascending: false })
        .limit(5),
    ]);
    if (
      ingestRes.data &&
      typeof ingestRes.data.ingested_at === "string"
    ) {
      lastIngested = ingestRes.data.ingested_at;
    }
    if (!dayRes.error) {
      last24h = dayRes.count ?? 0;
    }
    if (!runsRes.error && Array.isArray(runsRes.data)) {
      recentRuns = (runsRes.data as Array<Record<string, unknown>>)
        .map((r) => ({
          started_at: String(r.started_at),
          duration_ms: typeof r.duration_ms === "number" ? r.duration_ms : null,
          status: ((r.status as string) || "ok") as CronRunInfo["status"],
          inserted: typeof r.inserted === "number" ? r.inserted : null,
          error: typeof r.error === "string" ? r.error : null,
          trigger: ((r.trigger as string) || "cron") as CronRunInfo["trigger"],
        }))
        .filter((r) => r.started_at !== "undefined");
    }

    // Status derivation. cron_runs adds a stronger signal: if the
    // most recent run is an error AND the latest table ingest is
    // older than that, prefer 'error' over 'stale'/'ok'.
    if (totalRows === 0) {
      status = "empty";
    } else if (lastIngested) {
      const ageHours =
        (Date.now() - new Date(lastIngested).getTime()) / 3_600_000;
      if (ageHours > STALE_HOURS && spec.schedule.startsWith("0 ")) {
        status = "stale";
      }
    }
    if (recentRuns.length > 0 && recentRuns[0].status === "error") {
      const lastRunMs = new Date(recentRuns[0].started_at).getTime();
      const lastIngestMs = lastIngested ? new Date(lastIngested).getTime() : 0;
      if (lastRunMs > lastIngestMs) status = "error";
    }
  } catch {
    status = "error";
  }

  return {
    table: spec.table,
    cron_path: spec.cron_path,
    schedule: spec.schedule,
    wave: spec.wave,
    description: spec.description,
    total_rows: totalRows,
    last_ingested_at: lastIngested,
    last_24h: last24h,
    status,
    recent_runs: recentRuns,
  };
}

export async function GET() {
  // God-mode gate.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isGodModeEmail(user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Enrichment fill rates (2026-06-10) — the operator-facing measure of
  // lead quality. Single-scan RPC (migration 00108), best-effort so a
  // slow scan never breaks the whole panel.
  let enrichment: Record<string, number | null> | null = null;
  try {
    const admin = createAdminClient();
    const { data: fr } = await admin.rpc("get_lead_fill_rates");
    if (fr) enrichment = fr as Record<string, number | null>;
  } catch {
    enrichment = null;
  }

  const results = await Promise.all(TABLES.map(probeTable));
  // Order: errors → stale → empty → ok, then by wave.
  const statusOrder: Record<HealthRow["status"], number> = {
    error: 0,
    stale: 1,
    empty: 2,
    ok: 3,
  };
  results.sort((a, b) => {
    const s = statusOrder[a.status] - statusOrder[b.status];
    if (s !== 0) return s;
    return a.wave.localeCompare(b.wave) || a.table.localeCompare(b.table);
  });

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      enrichment,
      tables: results,
    },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
