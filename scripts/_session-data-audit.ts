/**
 * One-off data audit — verifies the live DB has real data populated and
 * reports the state of every important table the dashboard reads from.
 *
 * Usage: `npx tsx scripts/_session-data-audit.ts`
 *
 * Read-only. No writes, no DDL. Uses the service-role key to bypass RLS
 * so the counts are TRUE counts, not what a single contractor can see.
 *
 * Underscore-prefix marks this as an investigation script, not a
 * recurring tool. Safe to delete after the session.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE env. Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type CountResult = { table: string; count: number | null; error?: string; mode: "exact" | "planned" | "fail" };

/**
 * Count a table with a graceful degrade. PostgREST's `count: "exact"`
 * times out silently on very large tables (133k+ rows in `leads`) —
 * returns null in `count` even when the row exists. We race exact
 * against a 3 s timeout, fall through to `count: "planned"` (planner
 * estimate, ~50 ms) if exact loses. Mode is reported so the caller
 * knows whether the number is exact or estimated.
 */
async function countTable(table: string): Promise<CountResult> {
  const exactPromise = supabase.from(table).select("*", { count: "exact", head: true });
  const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) =>
    setTimeout(() => resolve({ kind: "timeout" }), 3000),
  );
  const winner = await Promise.race([exactPromise, timeoutPromise]);
  if ("count" in winner && !winner.error && winner.count != null) {
    return { table, count: winner.count, mode: "exact" };
  }
  // Fall back to planner estimate
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "planned", head: true });
  if (error) return { table, count: null, error: error.message, mode: "fail" };
  return { table, count: count ?? null, mode: "planned" };
}

/** Filtered count with exact-vs-planned race. Same pattern as countTable —
 *  on a 133k-row table the exact path can time out PostgREST silently;
 *  the planner estimate is good enough for fill-rate trend lines. */
async function fillRate(field: string): Promise<{ field: string; populated: number | null; mode: "exact" | "planned" | "fail"; error?: string }> {
  const exactPromise = supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .not(field, "is", null);
  const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) =>
    setTimeout(() => resolve({ kind: "timeout" }), 3000),
  );
  const winner = await Promise.race([exactPromise, timeoutPromise]);
  if ("count" in winner && !winner.error && winner.count != null) {
    return { field, populated: winner.count, mode: "exact" };
  }
  const { count, error } = await supabase
    .from("leads")
    .select("*", { count: "planned", head: true })
    .not(field, "is", null);
  if (error) return { field, populated: null, error: error.message, mode: "fail" };
  return { field, populated: count ?? null, mode: "planned" };
}

/** Same race pattern for a numeric range filter — used by the score
 *  distribution. Without it, the exact-count for a sub-range silently
 *  times out and reports 0, masking the real distribution. */
async function rangeCount(field: string, lo: number, hi: number): Promise<{ count: number | null; mode: string }> {
  const exactPromise = supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .gte(field, lo)
    .lt(field, hi);
  const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) =>
    setTimeout(() => resolve({ kind: "timeout" }), 3000),
  );
  const winner = await Promise.race([exactPromise, timeoutPromise]);
  if ("count" in winner && !winner.error && winner.count != null) {
    return { count: winner.count, mode: "exact" };
  }
  const { count } = await supabase
    .from("leads")
    .select("*", { count: "planned", head: true })
    .gte(field, lo)
    .lt(field, hi);
  return { count: count ?? null, mode: "planned" };
}

async function main() {
  console.log("=== HENRI DATA AUDIT ===\n");

  // 1. Top-level counts. Some are exact, some fall back to planner
  // estimate when exact times out — the mode column makes it clear.
  console.log("Tables (counts via service-role; ~ = planner estimate):");
  const tables = [
    "permits",
    "leads",
    "profiles",
    "territories",
    "estimates",
    "outreach_attempts",
    "outreach_templates",
    "exclusivity_locks",
    "storm_events",
  ];
  let leadsCount = 0;
  for (const t of tables) {
    const r = await countTable(t);
    if (r.error) {
      console.log(`  ${t.padEnd(22)} ERROR  ${r.error}`);
    } else {
      const tag = r.mode === "exact" ? " " : "~";
      console.log(`  ${t.padEnd(22)} ${tag}${(r.count ?? 0).toLocaleString().padStart(10)}`);
      if (t === "leads") leadsCount = r.count ?? 0;
    }
  }

  // 2. Permit freshness
  console.log("\nPermit freshness:");
  const { count: total } = await supabase.from("permits").select("*", { count: "exact", head: true });
  const since = (days: number) =>
    supabase
      .from("permits")
      .select("*", { count: "exact", head: true })
      .gt("issued_date", new Date(Date.now() - days * 86400e3).toISOString());
  const r1 = await since(1);
  const r7 = await since(7);
  const r30 = await since(30);
  const r90 = await since(90);
  console.log(`  total           ${(total ?? 0).toLocaleString().padStart(10)}`);
  console.log(`  last 1 day      ${(r1.count ?? 0).toLocaleString().padStart(10)}`);
  console.log(`  last 7 days     ${(r7.count ?? 0).toLocaleString().padStart(10)}`);
  console.log(`  last 30 days    ${(r30.count ?? 0).toLocaleString().padStart(10)}`);
  console.log(`  last 90 days    ${(r90.count ?? 0).toLocaleString().padStart(10)}`);

  // 3. Permit state coverage — paginate around PostgREST's 1000-row default.
  // Iterate 50 pages of 1000 each for a 50k sample window, which is enough
  // to surface the long tail without hammering the DB. For an exact count
  // per state the right path would be a SQL view; this is just a smoke-test.
  console.log("\nPermit state coverage (sampled, top 15):");
  const stateMap = new Map<string, number>();
  const PAGE = 1000;
  const PAGES = 50;
  for (let p = 0; p < PAGES; p++) {
    const { data, error } = await supabase
      .from("permits")
      .select("state")
      .range(p * PAGE, (p + 1) * PAGE - 1);
    if (error || !data?.length) break;
    for (const r of data) {
      const s = (r as { state: string | null }).state ?? "—";
      stateMap.set(s, (stateMap.get(s) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
  }
  const topStates = Array.from(stateMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  for (const [state, n] of topStates) {
    console.log(`  ${state.padEnd(4)} ${n.toLocaleString().padStart(8)}`);
  }
  console.log(`  (states represented in ${PAGES * PAGE}-row sample: ${stateMap.size})`);

  // 4. Lead enrichment fill rates — denominator comes from the count
  // captured in section 1 (with planner-estimate fallback so we don't
  // divide by 0 when exact-count times out on the 133k-row table).
  console.log(`\nLead enrichment fill rates (n=${leadsCount.toLocaleString()}):`);
  const fields = [
    "owner_name",
    "owner_first",
    "owner_last",
    "phone",
    "email",
    "year_built",
    "home_sqft",
    "assessed_value",
    "property_value",
    "mailing_address",
    "owner_occupied",
    "score_signals",
  ];
  for (const f of fields) {
    const r = await fillRate(f);
    if (r.error) {
      console.log(`  ${f.padEnd(22)} ERROR  ${r.error}`);
      continue;
    }
    const pct = leadsCount > 0 ? Math.round((r.populated! / leadsCount) * 100) : 0;
    console.log(
      `  ${f.padEnd(22)} ${(r.populated ?? 0).toLocaleString().padStart(10)}  (${String(pct).padStart(3)}%)`,
    );
  }

  // 5. Probe new column from migration 00051
  console.log("\nMigration 00051 (last_enriched_at):");
  const probe = await supabase
    .from("leads")
    .select("last_enriched_at")
    .limit(1);
  if (probe.error) {
    console.log(`  status: NOT APPLIED — ${probe.error.message}`);
    console.log(`  remediation: paste supabase/migrations/00051_last_enriched_at.sql into Supabase SQL editor`);
  } else {
    console.log(`  status: APPLIED — column exists`);
    const stale = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .or(`last_enriched_at.is.null,last_enriched_at.lt.${new Date(Date.now() - 30 * 86400e3).toISOString()}`);
    console.log(`  stale leads (NULL or > 30d): ${(stale.count ?? 0).toLocaleString()}`);
  }

  // 6. Other recent migration probes
  console.log("\nRecent migration probes:");
  const probes: Array<[string, string, string]> = [
    ["00031 lead_exclusivity_locks", "lead_exclusivity_locks", "id"],
    ["00045 cross_trade_suggestions", "leads", "cross_trade_suggestions"],
    ["00046 referral_credits", "referral_credits", "id"],
    ["00047 outreach_templates", "outreach_templates", "id"],
    ["00050 storm_events", "storm_events", "id"],
  ];
  for (const [name, table, col] of probes) {
    const { error } = await supabase.from(table).select(col).limit(1);
    console.log(`  ${name.padEnd(34)} ${error ? "MISSING — " + error.message.slice(0, 60) : "OK"}`);
  }

  // 7. Score distribution — race-with-timeout for each bucket so a
  // slow exact-count doesn't drop the bucket to 0.
  console.log("\nLead score distribution:");
  const buckets: Array<[string, number, number]> = [
    ["hot   (75+)", 75, 101],
    ["warm  (50-74)", 50, 75],
    ["cool  (25-49)", 25, 50],
    ["cold  (0-24)", 0, 25],
  ];
  for (const [label, lo, hi] of buckets) {
    const r = await rangeCount("score", lo, hi);
    const tag = r.mode === "exact" ? " " : "~";
    console.log(`  ${label.padEnd(14)} ${tag}${(r.count ?? 0).toLocaleString().padStart(10)}`);
  }

  // 8. A live sample for sanity
  console.log("\nLive sample — 3 newest hot leads (score >= 75):");
  const { data: sample, error: sampleErr } = await supabase
    .from("leads")
    .select("id, address, city, state, zip, score, owner_name, phone, email, year_built, contact_source")
    .gte("score", 75)
    .order("created_at", { ascending: false })
    .limit(3);
  if (sampleErr) {
    console.log(`  ERROR: ${sampleErr.message}`);
  } else if (!sample?.length) {
    console.log(`  (no hot leads found — check scoring cron)`);
  } else {
    for (const row of sample) {
      const r = row as Record<string, unknown>;
      console.log(`  [${r.score}] ${r.address}, ${r.city}, ${r.state} ${r.zip}`);
      console.log(
        `      owner=${r.owner_name ?? "—"}, phone=${r.phone ?? "—"}, email=${r.email ?? "—"}, year_built=${r.year_built ?? "—"}, src=${r.contact_source ?? "—"}`,
      );
    }
  }

  console.log("\n=== DONE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
