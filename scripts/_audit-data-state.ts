/**
 * Quick audit script — counts permits / leads / permit_sources / breakdown by
 * `discovered_via`. Used to confirm what's been ingested vs what's still
 * sitting in `C:/Users/yabis/Desktop/Data Henri 3/` waiting to land.
 *
 * Usage: npx tsx scripts/_audit-data-state.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SR) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const s = createClient(SUPABASE_URL, SR, { auth: { persistSession: false } });

async function count(table: string, filter?: (q: ReturnType<typeof s.from>) => unknown): Promise<number> {
  // estimated count is fast even on 1.5M-row permits table — exact count
  // does a sequential scan that hits the 8s statement timeout.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = s.from(table).select("*", { count: "estimated", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message || JSON.stringify(error)}`);
  return count ?? 0;
}

async function main() {
  console.log("── Henri data audit ────────────────────────────────────");

  const permitsTotal = await count("permits");
  const permitsUnscored = await count("permits", (q) => q.is("scored_at", null));
  const leadsTotal = await count("leads");
  const leadsGeocoded = await count("leads", (q) =>
    q.not("latitude", "is", null).not("longitude", "is", null),
  );
  const sourcesTotal = await count("permit_sources");
  const sourcesEnabled = await count("permit_sources", (q) => q.eq("enabled", true));

  console.log("\nCore counts:");
  console.log(`  permits           : ${permitsTotal.toLocaleString()}`);
  console.log(`  permits unscored  : ${permitsUnscored.toLocaleString()}`);
  console.log(`  leads             : ${leadsTotal.toLocaleString()}`);
  console.log(`  leads geocoded    : ${leadsGeocoded.toLocaleString()}`);
  console.log(`  permit_sources    : ${sourcesTotal.toLocaleString()}`);
  console.log(`  ...enabled=true   : ${sourcesEnabled.toLocaleString()}`);

  // Probe permit_sources columns. PostgREST's column-existence error has
  // multiple shapes; we look for the canonical "could not find" / "does not
  // exist" message rather than just `error != null`.
  const probe = async (col: string): Promise<boolean> => {
    const { error } = await s.from("permit_sources").select(col).limit(1);
    if (!error) return true;
    return !/does not exist|Could not find|column .* does not/i.test(error.message);
  };
  const hasDiscoveredVia = await probe("discovered_via");
  const hasNotes = await probe("notes");
  const hasFms = await probe("field_mapping_status");
  console.log(`\npermit_sources schema probe:`);
  console.log(`  discovered_via column   : ${hasDiscoveredVia ? "yes" : "MISSING (mig 00052 unapplied)"}`);
  console.log(`  field_mapping_status    : ${hasFms ? "yes" : "MISSING"}`);
  console.log(`  notes column            : ${hasNotes ? "yes" : "MISSING"}`);

  // Henri-FINAL provenance check — count rows tagged with the new importer.
  if (hasDiscoveredVia) {
    const { count: finalCount } = await s
      .from("permit_sources")
      .select("*", { count: "estimated", head: true })
      .eq("discovered_via", "henri_final_no_auth_2026_04_22");
    console.log(`\nFINAL catalog rows landed (discovered_via='henri_final_no_auth_2026_04_22'): ${(finalCount ?? 0).toLocaleString()}`);
  }

  // Bucket by source_type — works on every schema variant.
  const { data: typeRows } = await s.from("permit_sources").select("source_type").limit(500_000);
  const typeBuckets = new Map<string, number>();
  for (const r of typeRows ?? []) {
    const k = (r.source_type as string) ?? "<null>";
    typeBuckets.set(k, (typeBuckets.get(k) ?? 0) + 1);
  }
  console.log(`\nBreakdown by source_type:`);
  for (const [t, n] of [...typeBuckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(50)} ${n.toLocaleString().padStart(10)}`);
  }

  // If discovered_via exists, show its breakdown too.
  if (hasDiscoveredVia) {
    console.log(`\nBreakdown by discovered_via (top 30):`);
    const { data: rows } = await s.from("permit_sources").select("discovered_via").limit(500_000);
    const buckets = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = ((r as Record<string, unknown>).discovered_via as string) ?? "<null>";
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    for (const [tag, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      console.log(`  ${tag.padEnd(50)} ${n.toLocaleString().padStart(10)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
