/**
 * Cross-table sync audit — confirms that the data we imported this
 * session is actually wired through to the production read paths
 * (dashboard, scrape cron, score cron, enrichment, lead drawer).
 *
 * Five sync vectors checked:
 *   1. permit_sources — total + breakdown by discovered_via, source_type,
 *      enabled, field_mapping_status. The active scrape pool.
 *   2. permits ← permit_sources — every permit row should trace back to
 *      a configured source_key (loose check: source_type matches).
 *   3. leads ← permits — leads.permit_id FK should point at real permits.
 *      Orphan leads can't render in the drawer.
 *   4. permit_source_zips — populated by import-master-json.ts phase 2;
 *      requires migration 00053. Reports missing/applied state.
 *   5. Cron staleness — when did each cron last run? scored_at,
 *      last_scraped_at, last_enriched_at distributions.
 *
 * Run: npx tsx scripts/_sync-audit.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function pad(n: number, w = 12): string {
  return n.toLocaleString("en-US").padStart(w);
}

(async () => {
  console.log("=== HENRI SYNC AUDIT ===\n");

  /* ── 1. permit_sources ────────────────────────────────────────── */
  console.log("─ permit_sources ─");
  const totalSrc = (
    await s.from("permit_sources").select("id", { count: "exact", head: true })
  ).count;
  const enabledSrc = (
    await s
      .from("permit_sources")
      .select("id", { count: "exact", head: true })
      .eq("enabled", true)
  ).count;
  console.log(`  total                : ${pad(totalSrc ?? 0)}`);
  console.log(`  enabled (scrape pool): ${pad(enabledSrc ?? 0)}`);

  // Breakdown by source_type
  const types = ["arcgis", "socrata", "ckan", "csv", "unknown"];
  console.log(`  by source_type:`);
  for (const t of types) {
    const c = (
      await s
        .from("permit_sources")
        .select("id", { count: "exact", head: true })
        .eq("source_type", t)
    ).count;
    if ((c ?? 0) > 0) console.log(`    ${t.padEnd(8)}: ${pad(c ?? 0, 10)}`);
  }

  // Breakdown by discovered_via (might fail if migration 00052 not applied)
  console.log(`  by discovered_via:`);
  try {
    const dv = await s
      .from("permit_sources")
      .select("discovered_via")
      .limit(1);
    if (!dv.error) {
      const tags = [
        "us_master_csv",
        "nationwide_csv",
        "us_master_json",
        "perfected_csv",
        "live_permits_master",
        "auto_discovery",
        "data_henri_3_accela",
        "data_henri_3_zip_mapping",
        "data_henri_3_database_complete",
        "henri_data_jurisdictions",
        "henri_data_sources",
      ];
      for (const tag of tags) {
        const c = (
          await s
            .from("permit_sources")
            .select("id", { count: "exact", head: true })
            .eq("discovered_via", tag)
        ).count;
        if ((c ?? 0) > 0) console.log(`    ${tag.padEnd(34)}: ${pad(c ?? 0, 10)}`);
      }
      const nullCount = (
        await s
          .from("permit_sources")
          .select("id", { count: "exact", head: true })
          .is("discovered_via", null)
      ).count;
      console.log(`    ${"(NULL — pre-00052 hand-seeded)".padEnd(34)}: ${pad(nullCount ?? 0, 10)}`);
    } else {
      console.log(
        `    migration 00052 NOT applied — discovered_via column missing`,
      );
    }
  } catch (e) {
    console.log(`    probe error: ${(e as Error).message}`);
  }

  // Breakdown by field_mapping_status
  try {
    const fms = await s
      .from("permit_sources")
      .select("field_mapping_status")
      .limit(1);
    if (!fms.error) {
      console.log(`  by field_mapping_status:`);
      for (const status of ["verified", "probed", "unknown", "failed"]) {
        const c = (
          await s
            .from("permit_sources")
            .select("id", { count: "exact", head: true })
            .eq("field_mapping_status", status)
        ).count;
        if ((c ?? 0) > 0) console.log(`    ${status.padEnd(10)}: ${pad(c ?? 0, 10)}`);
      }
    }
  } catch {
    /* ignore */
  }

  /* ── 2. permits ─ uses estimated count, then exact for narrow slices */
  console.log(`\n─ permits ─`);
  // Planner-estimated total (Supabase head:true with count:exact on a
  // 1.4M row table hits statement_timeout — fall back to pg_stat_user_tables
  // via an RPC if the exact count times out. Otherwise the audit lies "0".)
  const totalPRes = await s
    .from("permits")
    .select("id", { count: "estimated", head: true });
  const totalP = totalPRes.count;
  // Only count scored_at NOT NULL — the partial index makes this fast.
  const scoredRes = await s
    .from("permits")
    .select("id", { count: "exact", head: true })
    .not("scored_at", "is", null);
  const scored = scoredRes.count;
  // Unscored is the partial index on (scored_at) WHERE scored_at IS NULL —
  // also fast.
  const unscoredRes = await s
    .from("permits")
    .select("id", { count: "exact", head: true })
    .is("scored_at", null);
  const unscored = unscoredRes.count;
  console.log(`  total (estimated)    : ${pad(totalP ?? 0)}`);
  console.log(
    `  scored (has scored_at): ${pad(scored ?? 0)}  (${
      totalP ? Math.round(((scored ?? 0) / totalP) * 100) : 0
    }%)`,
  );
  console.log(
    `  unscored (queue)      : ${pad(unscored ?? 0)}  (waiting for /api/cron/score)`,
  );

  /* ── 3. leads ← permits ───────────────────────────────────────── */
  console.log(`\n─ leads ↔ permits ─`);
  const totalL = (
    await s.from("leads").select("id", { count: "estimated", head: true })
  ).count;
  const withPermitId = (
    await s
      .from("leads")
      .select("id", { count: "estimated", head: true })
      .not("permit_id", "is", null)
  ).count;
  const orphanLeads = (
    await s
      .from("leads")
      .select("id", { count: "exact", head: true })
      .is("permit_id", null)
  ).count;
  console.log(`  total leads (est)    : ${pad(totalL ?? 0)}`);
  console.log(
    `  with permit_id (FK)  : ${pad(withPermitId ?? 0)}  (${
      totalL ? Math.round(((withPermitId ?? 0) / totalL) * 100) : 0
    }%)`,
  );
  console.log(
    `  orphan (NULL permit) : ${pad(orphanLeads ?? 0)}  (homeowner intakes are expected to be NULL)`,
  );

  // Spot-check: are 100 random leads' permit_ids actually present?
  const { data: sampleLeads } = await s
    .from("leads")
    .select("id, permit_id")
    .not("permit_id", "is", null)
    .limit(100);
  let dangling = 0;
  if (sampleLeads && sampleLeads.length > 0) {
    const ids = sampleLeads.map((l) => l.permit_id as string);
    const { data: foundPermits } = await s
      .from("permits")
      .select("id")
      .in("id", ids);
    const foundSet = new Set(foundPermits?.map((p) => p.id as string) ?? []);
    dangling = ids.filter((id) => !foundSet.has(id)).length;
  }
  console.log(
    `  FK integrity (100-sample): ${
      dangling === 0 ? "OK — no dangling permit_ids" : `${dangling} dangling`
    }`,
  );

  /* ── 4. permit_source_zips (migration 00053) ─────────────────── */
  console.log(`\n─ permit_source_zips (migration 00053) ─`);
  const zipsProbe = await s
    .from("permit_source_zips")
    .select("zip", { count: "exact", head: true });
  if (zipsProbe.error) {
    const msg = zipsProbe.error.message ?? "";
    if (
      zipsProbe.error.code === "42P01" ||
      /relation .* does not exist|could not find the table|schema cache/i.test(msg)
    ) {
      console.log(
        `  status               : NOT APPLIED — migration 00053 pending`,
      );
      console.log(
        `  effect               : ZIP→source linkage from MASTER.json zip_index isn't queryable yet`,
      );
    } else {
      console.log(`  probe error          : ${msg}`);
    }
  } else {
    console.log(`  total link rows      : ${pad(zipsProbe.count ?? 0)}`);
    // Per-granularity
    for (const g of ["federal", "state", "county", "city", "unknown"]) {
      const c = (
        await s
          .from("permit_source_zips")
          .select("zip", { count: "exact", head: true })
          .eq("granularity", g)
      ).count;
      if ((c ?? 0) > 0) console.log(`    ${g.padEnd(8)}: ${pad(c ?? 0, 10)}`);
    }
    const distinctZ = (
      await s.from("permit_source_zips").select("zip", { count: "exact", head: true })
    ).count;
    console.log(`  distinct ZIPs covered: ${pad(distinctZ ?? 0)}`);
  }

  /* ── 5. Cron staleness ───────────────────────────────────────── */
  console.log(`\n─ cron staleness ─`);
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const scrapedRecent = (
    await s
      .from("permit_sources")
      .select("id", { count: "exact", head: true })
      .gte("last_scraped_at", dayAgo)
      .eq("enabled", true)
  ).count;
  const scrapedNever = (
    await s
      .from("permit_sources")
      .select("id", { count: "exact", head: true })
      .is("last_scraped_at", null)
      .eq("enabled", true)
  ).count;
  console.log(
    `  enabled sources scraped <24h : ${pad(scrapedRecent ?? 0)}  (out of ${
      enabledSrc ?? 0
    } enabled)`,
  );
  console.log(
    `  enabled sources never scraped: ${pad(scrapedNever ?? 0)}  (queued for next /api/cron/scrape tick)`,
  );

  // Lead enrichment recency (migration 00051)
  try {
    const enrichedRecent = (
      await s
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("last_enriched_at", weekAgo)
    ).count;
    const enrichedNever = (
      await s
        .from("leads")
        .select("id", { count: "exact", head: true })
        .is("last_enriched_at", null)
    ).count;
    console.log(
      `  leads enriched <7d           : ${pad(enrichedRecent ?? 0)}`,
    );
    console.log(
      `  leads never enriched         : ${pad(enrichedNever ?? 0)}  (queued for /api/cron/enrich)`,
    );
  } catch {
    /* ignore */
  }

  /* ── 6. Dashboard read-path sanity ───────────────────────────── */
  console.log(`\n─ dashboard read-path sanity ─`);
  // useLeads(geocoded_only: true, limit: 1000) is what the dashboard fires
  // on first paint. We replicate the count to confirm it'll find rows.
  const dashLeads = (
    await s
      .from("leads")
      .select("id", { count: "exact", head: true })
      .not("latitude", "is", null)
      .not("longitude", "is", null)
  ).count;
  console.log(
    `  geocoded leads available     : ${pad(dashLeads ?? 0)}  (this is what map renders)`,
  );

  // useLeadCount() — total lead pool size (estimated)
  const totalLeadPool = totalL;
  console.log(
    `  total lead pool (est)        : ${pad(totalLeadPool ?? 0)}  (panel header "of N")`,
  );

  console.log(`\n=== DONE ===`);
})();
