/**
 * Sanity probe — did the FINAL importer actually land rows? Queries by
 * source_key prefix (which is independent of the provenance columns).
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

async function main() {
  console.log("── FINAL-import probe ─────────────────────");

  // Sample one of the rows we just upserted (Maricopa County permits — first
  // row of permits CSV).
  const { data: maricopa, error: mErr } = await s
    .from("permit_sources")
    .select("*")
    .eq("source_key", "csv:AZ:maricopa-county:opa-gov-file")
    .maybeSingle();
  if (mErr) console.log("  maricopa probe error:", mErr.message);
  else console.log("  Maricopa County (permits, sample) row:", maricopa ? "FOUND" : "NOT FOUND");
  if (maricopa) {
    console.log("    columns:", Object.keys(maricopa).join(", "));
    console.log("    discovered_via:", (maricopa as Record<string, unknown>).discovered_via ?? "<undefined>");
    console.log("    notes         :", (maricopa as Record<string, unknown>).notes ?? "<undefined>");
    console.log("    enabled       :", (maricopa as Record<string, unknown>).enabled);
  }

  // Sample assessor row.
  const { data: jeff } = await s
    .from("permit_sources")
    .select("*")
    .eq("source_key", "assessor:html:AL:jefferson-county:lt-asp-id-82")
    .maybeSingle();
  console.log("\n  Jefferson County (assessor, sample) row:", jeff ? "FOUND" : "NOT FOUND");
  if (jeff) {
    console.log("    discovered_via:", (jeff as Record<string, unknown>).discovered_via ?? "<undefined>");
    console.log("    notes         :", (jeff as Record<string, unknown>).notes ?? "<undefined>");
    console.log("    enabled       :", (jeff as Record<string, unknown>).enabled);
  }

  // Count rows whose source_key matches the FINAL-importer naming pattern.
  const { count: assessorCount } = await s
    .from("permit_sources")
    .select("*", { count: "exact", head: true })
    .ilike("source_key", "assessor:%");
  console.log(`\n  Rows with source_key ilike 'assessor:%' : ${(assessorCount ?? 0).toLocaleString()}`);

  // Was the maricopa row actually touched by our upsert just now? Check the
  // updated_at timestamp.
  const { data: m2 } = await s
    .from("permit_sources")
    .select("source_key, updated_at, created_at, enabled")
    .eq("source_key", "csv:AZ:maricopa-county:opa-gov-file")
    .maybeSingle();
  if (m2) {
    const u = new Date((m2 as Record<string, string>).updated_at);
    const ageSec = (Date.now() - u.getTime()) / 1000;
    console.log(`\n  Maricopa row updated_at age: ${Math.round(ageSec)}s ago (${u.toISOString()})`);
  }

  // Recently-touched rows (in the last 5 min) — should be ~2,795 after the
  // FINAL importer just ran.
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count: recentCount } = await s
    .from("permit_sources")
    .select("*", { count: "exact", head: true })
    .gte("updated_at", fiveMinAgo);
  console.log(`  permit_sources rows touched in last 5min: ${(recentCount ?? 0).toLocaleString()}`);

  // How many of those are now enabled=true?
  const { count: recentEnabled } = await s
    .from("permit_sources")
    .select("*", { count: "exact", head: true })
    .gte("updated_at", fiveMinAgo)
    .eq("enabled", true);
  console.log(`  ... of which enabled=true             : ${(recentEnabled ?? 0).toLocaleString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
