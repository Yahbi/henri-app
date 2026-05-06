/**
 * Propagate permits.latitude/longitude → leads.latitude/longitude.
 *
 * The score cron writes lat/lng to leads at score-time by reading from the
 * permit row. When we backfill permit coords AFTER scoring (via
 * scripts/backfill-geocode.ts), the existing lead rows keep their NULL
 * coords because nothing re-reads the permit. This script closes the gap:
 *
 *   For each lead with NULL latitude OR longitude, look up its joined
 *   permit's lat/lng and write them back.
 *
 * Idempotent. Bounded — pages 1k leads at a time, with the partial-result
 * tolerance pattern from useLeads.ts.
 *
 * Usage:
 *   npx tsx scripts/_propagate-coords-leads.ts
 *
 * Env:
 *   PROPAGATE_LIMIT=5000  # optional cap (default: drain everything)
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

const LIMIT = Number(process.env.PROPAGATE_LIMIT ?? 0);

async function main() {
  console.log("── Propagate permit coords → leads ─────────────────────");

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalScanned = 0;
  let pageNum = 0;

  // Loop until no more null-coord leads left or LIMIT reached.
  while (true) {
    if (LIMIT > 0 && totalScanned >= LIMIT) {
      console.log(`  hit PROPAGATE_LIMIT=${LIMIT}; stopping`);
      break;
    }
    pageNum++;
    // Pull 1000 leads with NULL lat/lng + joined permit's lat/lng.
    const { data, error } = await s
      .from("leads")
      .select("id, permit_id, latitude, longitude, permits(latitude, longitude)")
      .or("latitude.is.null,longitude.is.null")
      .limit(1000);
    if (error) {
      console.error(`  page ${pageNum} fetch failed:`, error.message);
      break;
    }
    if (!data || data.length === 0) {
      console.log(`  page ${pageNum}: no more null-coord leads`);
      break;
    }
    totalScanned += data.length;

    // Filter to rows where the permit HAS coords. Skip those still null.
    const updates: Array<{ id: string; latitude: number; longitude: number }> = [];
    for (const row of data) {
      const r = row as unknown as {
        id: string;
        permits: { latitude: number | null; longitude: number | null } | null;
      };
      const permit = r.permits;
      if (!permit) {
        totalSkipped++;
        continue;
      }
      if (permit.latitude == null || permit.longitude == null) {
        totalSkipped++;
        continue;
      }
      updates.push({
        id: r.id,
        latitude: permit.latitude,
        longitude: permit.longitude,
      });
    }

    if (updates.length === 0) {
      console.log(`  page ${pageNum}: 0/${data.length} had permit coords; trying next page`);
      // Critical: if we don't move past this null-coord cluster, the same
      // page comes back forever. Bail when an entire batch has no
      // permit-coord matches — those leads need their permits geocoded
      // first via scripts/backfill-geocode.ts.
      if (data.length === 1000 && pageNum >= 3) {
        console.log(`  pages ${pageNum-2}-${pageNum} all empty → permits backlog; stopping.`);
        console.log(`  → run scripts/backfill-geocode.ts repeatedly to fill permit coords first.`);
        break;
      }
      continue;
    }

    // Issue per-row updates. Supabase doesn't support batched UPDATEs
    // with different values per row via the JS client, so we send N
    // requests in parallel chunks of 25 to keep latency tolerable.
    const CHUNK = 25;
    let pageOk = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const slice = updates.slice(i, i + CHUNK);
      const results = await Promise.all(
        slice.map((u) =>
          s
            .from("leads")
            .update({ latitude: u.latitude, longitude: u.longitude })
            .eq("id", u.id)
            .then(({ error }) => (error ? 0 : 1)),
        ),
      );
      pageOk += results.reduce((a, b) => a + b, 0);
    }
    totalUpdated += pageOk;
    console.log(`  page ${pageNum}: scanned=${data.length}, updated=${pageOk}, total_updated=${totalUpdated}`);
  }

  console.log(`\nDone. Scanned ${totalScanned.toLocaleString()} leads, updated ${totalUpdated.toLocaleString()}, skipped ${totalSkipped.toLocaleString()} (permit had no coords).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
