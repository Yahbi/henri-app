/**
 * Post-sync audit: how much of the C:\...\Data Henri 3\ desktop dump
 * actually landed in Supabase, and where.
 *
 * Prints totals for:
 *   - permit_sources (total / enabled / legacy-sqlite sentinel states)
 *   - permits (total / legacy-sqlite sourced)
 *   - zip_reference (sanity — should still be 33,048)
 *
 * Safe read-only. Run after `sync-desktop-data.ts` +
 * `import-legacy-permits.ts` to confirm the full sweep settled.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function estCount(table: string, filter?: (q: any) => any): Promise<number> {
  let q = s.from(table).select("*", { count: "estimated", head: true });
  if (filter) q = filter(q);
  const { count } = await q;
  return count ?? 0;
}

(async () => {
  console.log("=== permit_sources ===");
  const sTotal = await estCount("permit_sources");
  const sEnabled = await estCount("permit_sources", (q) => q.eq("enabled", true));
  const sUnprobeable = await estCount("permit_sources", (q) => q.eq("error_count", 99));
  const sDead = await estCount("permit_sources", (q) => q.eq("error_count", 10));
  console.log(`  total=${sTotal.toLocaleString()}`);
  console.log(`  enabled=${sEnabled.toLocaleString()}`);
  console.log(`  unprobeable (platform sentinel err=99)=${sUnprobeable.toLocaleString()}`);
  console.log(`  quarantined (dead URL err=10)=${sDead.toLocaleString()}`);

  console.log("\n=== permits ===");
  const pTotal = await estCount("permits");
  const pLegacy = await estCount("permits", (q) => q.eq("source_city", "legacy-sqlite"));
  console.log(`  total=${pTotal.toLocaleString()}`);
  console.log(`  legacy-sqlite sentinel=${pLegacy.toLocaleString()}`);

  console.log("\n=== zip_reference ===");
  const zTotal = await estCount("zip_reference");
  console.log(`  total=${zTotal.toLocaleString()}  (expected ~33,048)`);
})();
