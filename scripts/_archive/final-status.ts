#!/usr/bin/env npx tsx
/* Summarize end state of permit ingestion. */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: sources } = await supabase
    .from("permit_sources")
    .select("source_key, city, state, source_type, enabled, last_scraped_at, last_count, error_count")
    .order("enabled", { ascending: false })
    .order("last_count", { ascending: false, nullsFirst: false });

  console.log("=".repeat(98));
  console.log("  permit_sources — final status");
  console.log("=".repeat(98));
  console.log(`${"source_key".padEnd(32)} ${"city".padEnd(16)} ${"state".padEnd(3)} ${"type".padEnd(8)} en  err  last_count  last_scraped_at`);
  console.log("-".repeat(98));
  let enabledCount = 0, disabledCount = 0, totalLast = 0;
  for (const r of sources ?? []) {
    const en = r.enabled ? "Y" : "n";
    if (r.enabled) enabledCount++; else disabledCount++;
    if (r.enabled && r.last_count) totalLast += r.last_count;
    const last = r.last_scraped_at ? new Date(r.last_scraped_at).toISOString().slice(0,16) : "never";
    console.log(
      `${r.source_key.padEnd(32)} ${String(r.city ?? "").padEnd(16)} ${r.state.padEnd(3)} ${r.source_type.padEnd(8)} ${en}    ${String(r.error_count ?? 0).padEnd(3)} ${String(r.last_count ?? "-").padStart(9)}  ${last}`
    );
  }
  console.log("-".repeat(98));
  console.log(`  ${enabledCount} enabled · ${disabledCount} disabled · sum(last_count)=${totalLast.toLocaleString()}`);

  // Sample a few permits to sanity-check data quality
  const { data: sample } = await supabase
    .from("permits")
    .select("source_city, state, permit_number, permit_type, status, address, zip, issued_date, estimated_value, latitude, longitude")
    .order("created_at", { ascending: false })
    .limit(8);
  console.log("\n  Most recently created permits:");
  for (const r of sample ?? []) {
    console.log(`    ${r.source_city.padEnd(14)} ${r.state}  ${(r.permit_number ?? "?").padEnd(20)} ${r.permit_type.padEnd(16)} ${r.status.padEnd(10)} lat=${r.latitude ?? "n/a"}`);
  }

  // Type mix
  const { data: mix } = await supabase.rpc("pg_temp_nothing").select().limit(0);
  void mix;
}

main().catch((e) => { console.error(e); process.exit(1); });
