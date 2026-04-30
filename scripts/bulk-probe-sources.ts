/**
 * Bulk-probe a subset of the 19,734 imported permit_sources. Picks
 * candidates by (1) platform we can probe — ArcGIS or Socrata, (2)
 * state coverage priority, (3) hasn't been probed yet. Runs ~100
 * probes concurrently-bounded, writes results back to the row.
 *
 * Usage:
 *   npx tsx scripts/bulk-probe-sources.ts            # process 500 sources
 *   PROBE_LIMIT=2000 npx tsx scripts/bulk-probe-sources.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
import { probeSource } from "../src/lib/sources/probe";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const LIMIT = Number(process.env.PROBE_LIMIT ?? 500);
// Concurrency — ArcGIS + Socrata servers are sturdy enough for this.
// Higher than 20 starts hitting rate-limits on some AWS-hosted feature
// servers.
const CONCURRENCY = 10;

/** Prioritize states with the most leads / territory interest. */
const STATE_PRIORITY = [
  "CA", "TX", "FL", "NY", "CT", "MD", "DC",
  "SD", "NC", "IL", "AZ", "WA", "OR", "CO",
  "MA", "NJ", "VA", "GA", "PA", "OH",
];

(async () => {
  // Pull candidate sources via PostgREST-paginated ranges. PostgREST
  // caps a single SELECT at 1,000 rows regardless of .limit(), so for
  // LIMIT > 1,000 we need to accumulate multiple .range() calls.
  // error_count >= 99 is the sentinel for "platform-unprobeable" (see
  // Phase 5b.3) — skip those forever.
  const PAGE = 1000;
  const sources: Array<{ source_key: string; name: string; state: string; source_type: string; endpoint: string; last_scraped_at: string | null }> = [];
  for (let offset = 0; offset < LIMIT; offset += PAGE) {
    const take = Math.min(PAGE, LIMIT - offset);
    const { data, error } = await s
      .from("permit_sources")
      .select("source_key, name, state, source_type, endpoint, last_scraped_at")
      .in("source_type", ["arcgis", "socrata", "ckan", "csv"])
      .eq("enabled", false)
      .or("error_count.is.null,error_count.lt.3")
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .range(offset, offset + take - 1);
    if (error) {
      console.error("scan error:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    sources.push(...(data as typeof sources));
    if (data.length < take) break;
  }
  if (!sources?.length) {
    console.log("no candidate sources");
    return;
  }
  // Stable-sort candidates so priority states go first.
  sources.sort((a, b) => {
    const pa = STATE_PRIORITY.indexOf(a.state as string);
    const pb = STATE_PRIORITY.indexOf(b.state as string);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });
  console.log(`probing ${sources.length} candidates, concurrency ${CONCURRENCY}`);

  let pos = 0;
  let enabled = 0;
  let reachable = 0;
  let failed = 0;
  const t0 = Date.now();

  async function worker() {
    while (pos < sources.length) {
      const row = sources[pos++];
      if (!row) break;
      try {
        const r = await probeSource(
          row.source_type as string,
          row.endpoint as string,
          row.name as string | undefined,
        );
        const patch: Record<string, unknown> = {
          last_scraped_at: new Date().toISOString(),
          last_count: r.row_count,
        };
        if (r.ok) {
          patch.error_count = 0;
          patch.enabled = true;
          Object.assign(patch, r.fields);
          enabled++;
        } else {
          if (r.reachable) reachable++;
          else failed++;
          // Platform-unprobeable sentinel: set error_count=99 so this
          // row is permanently excluded from the bulk probe query
          // (see `error_count.lt.3` filter above). Distinguished from
          // transient errors which just get +1.
          const isUnprobeable = r.error?.startsWith("platform-unprobeable");
          if (isUnprobeable) {
            patch.error_count = 99;
          } else {
            // Bump error count best-effort — read + increment is racy
            // at concurrency 10 but acceptable for a one-off ops script.
            const { data: cur } = await s
              .from("permit_sources")
              .select("error_count")
              .eq("source_key", row.source_key as string)
              .single();
            patch.error_count = (cur?.error_count ?? 0) + 1;
          }
        }
        await s
          .from("permit_sources")
          .update(patch)
          .eq("source_key", row.source_key as string);
      } catch (e) {
        failed++;
      }
      if ((enabled + reachable + failed) % 50 === 0) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        console.log(
          `  ${enabled + reachable + failed}/${sources.length} processed — enabled=${enabled} reachable-but-no-mapping=${reachable} failed=${failed} (${elapsed}s)`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(
    `\nDone. enabled=${enabled} reachable-no-mapping=${reachable} failed=${failed} of ${sources.length} in ${elapsed}s`,
  );
})();
