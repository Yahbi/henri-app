/* One-shot: clear (0, 0) and near-null-island coordinates on leads and
 * permits so the world-view map doesn't cluster bad data off West Africa.
 * The API-side filter in /api/leads/map already rejects these on read, but
 * this scrubs the DB so downstream aggregations and geocode-backfill get
 * a clean slate. Nominatim cron will re-geocode any row with NULL coords. */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  for (const table of ["leads", "permits"] as const) {
    // Exact (0, 0)
    const exact = await s.from(table).update({ latitude: null, longitude: null })
      .eq("latitude", 0).eq("longitude", 0).select("id");
    console.log(`  ${table}: exact (0,0) cleared ${exact.data?.length ?? 0}`);

    // Near null island — |lat|<0.5 and |lng|<0.5
    const near = await s.from(table).update({ latitude: null, longitude: null })
      .gte("latitude", -0.5).lte("latitude", 0.5)
      .gte("longitude", -0.5).lte("longitude", 0.5)
      .not("latitude", "is", null).not("longitude", "is", null)
      .select("id");
    console.log(`  ${table}: near null-island cleared ${near.data?.length ?? 0}`);
  }
  console.log("\nDone. Nominatim geocode-backfill cron will re-populate on its next sweep.");
})();
