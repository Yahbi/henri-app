/**
 * Delete permits that were written by the 5 off-topic sources the
 * Phase-5 scraper touched during the smoke test (CA water boundaries,
 * NWS watches, park-and-ride, air districts, USACE OK regulatory).
 *
 * The arcgis scraper writes `source_id = '{citySlug}_{rawId}'`. We use
 * the citySlug as a cheap discriminator — combined with source_city
 * and a tight updated_at window — to avoid deleting legitimate permits
 * from the same state.
 *
 * Safe to re-run (no-ops if the target rows are already gone).
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

// Rows updated or inserted since 30 min ago are within our smoke-test
// window. The scraper cron runs every 30 min, but last production run
// predates this smoke test; this window cleanly scopes to what we
// touched.
const UPDATED_SINCE = new Date(Date.now() - 30 * 60 * 1000).toISOString();

const TARGETS: Array<{
  city: string;            // matches permits.source_city exactly
  sourceIdPrefix: string;  // permits.source_id starts-with filter
  description: string;     // for logging
}> = [
  // arcgis scraper: source_id = `${source.city.toLowerCase().replace(/\s+/g, "_")}_${rawId}`
  { city: "OK", sourceIdPrefix: "ok_",
    description: "USACE OK statewide regulatory boundary" },
  { city: "",   sourceIdPrefix: "_",
    description: "CA sources with empty city (NWS / water / park-ride / air-districts)" },
];

(async () => {
  let totalDeleted = 0;
  for (const t of TARGETS) {
    console.log(`\n>>> ${t.description}`);
    console.log(`    source_city='${t.city}'  source_id LIKE '${t.sourceIdPrefix}%'  updated_at >= ${UPDATED_SINCE}`);

    // Count first so we can sanity-check before nuking.
    const { count } = await s
      .from("permits")
      .select("id", { count: "estimated", head: true })
      .eq("source_city", t.city)
      .like("source_id", `${t.sourceIdPrefix}%`)
      .gte("updated_at", UPDATED_SINCE);
    console.log(`    matched ~${count ?? 0} rows`);
    if (!count || count === 0) continue;

    // Delete — Supabase caps delete affect to reasonable batch; loop
    // until no more rows match.
    let iter = 0;
    while (iter++ < 20) {
      const { data, error } = await s
        .from("permits")
        .delete()
        .eq("source_city", t.city)
        .like("source_id", `${t.sourceIdPrefix}%`)
        .gte("updated_at", UPDATED_SINCE)
        .select("id");
      if (error) {
        console.warn(`    delete error: ${error.message}`);
        break;
      }
      const got = data?.length ?? 0;
      totalDeleted += got;
      console.log(`    iter ${iter}: deleted ${got}`);
      if (got < 1000) break;
    }
  }
  console.log(`\nDone. total deleted: ${totalDeleted.toLocaleString()}`);
})();
