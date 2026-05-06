/**
 * "Fresh" Socrata probe — targets rows that have NEVER been scraped
 * (`last_scraped_at IS NULL`). After the 105k US_COMPREHENSIVE_MASTER.json
 * import landed, ~99% of the new rows are never-touched, so this query
 * doesn't need ORDER BY last_scraped_at at all — every row in the result
 * set has the same NULL timestamp.
 *
 * Why a separate script:
 *   `bulk-probe-socrata.ts` orders by last_scraped_at ASC NULLS FIRST.
 *   On a permit_sources table that grew from ~280k → 380k rows, that
 *   ORDER BY now triggers Supabase's 8s statement timeout on the
 *   service-role connection pooler. By dropping the ORDER BY (every
 *   matched row tied at NULL anyway) we get a sequential-scan plan
 *   that returns in <1s.
 *
 * Usage:
 *   pnpm tsx scripts/bulk-probe-fresh.ts          # 1000 fresh rows
 *   PROBE_LIMIT=5000 pnpm tsx scripts/bulk-probe-fresh.ts
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

const LIMIT = Number(process.env.PROBE_LIMIT ?? 1000);
const CONCURRENCY = 12;
const SOCRATA_RE = /^https:\/\/[^/]+\/resource\/[a-z0-9]{4}-[a-z0-9]{4}\.json/i;

(async () => {
  // Pull fresh candidates — `last_scraped_at IS NULL` is the cheap path.
  // PostgREST caps at 1000 per response so paginate via .range().
  const PAGE = 1000;
  const sources: Array<{
    source_key: string;
    name: string;
    state: string;
    source_type: string;
    endpoint: string;
  }> = [];
  let offset = 0;
  while (sources.length < LIMIT) {
    const take = Math.min(PAGE, LIMIT - sources.length);
    const { data, error } = await s
      .from("permit_sources")
      .select("source_key, name, state, source_type, endpoint")
      .eq("source_type", "socrata")
      .eq("enabled", false)
      .is("last_scraped_at", null)
      .or("error_count.is.null,error_count.lt.3")
      .range(offset, offset + take - 1);
    if (error) {
      console.error("scan error:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (SOCRATA_RE.test(row.endpoint)) {
        sources.push(row as (typeof sources)[number]);
      }
    }
    offset += take;
    if (data.length < take) break;
  }

  if (!sources.length) {
    console.log("no fresh Socrata candidates left (all have been probed at least once)");
    return;
  }

  console.log(`probing ${sources.length} fresh Socrata candidates, concurrency ${CONCURRENCY}`);

  let pos = 0;
  let enabled = 0;
  let reachable = 0;
  let failed = 0;
  const t0 = Date.now();

  async function worker(): Promise<void> {
    while (pos < sources.length) {
      const row = sources[pos++];
      if (!row) break;
      try {
        const r = await probeSource("socrata", row.endpoint, row.name);
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
          const isUnprobeable = r.error?.startsWith("platform-unprobeable");
          if (isUnprobeable) {
            patch.error_count = 99;
          } else {
            patch.error_count = 1; // first failure
          }
        }
        await s
          .from("permit_sources")
          .update(patch)
          .eq("source_key", row.source_key);
      } catch {
        failed++;
      }
      if ((enabled + reachable + failed) % 100 === 0) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        console.log(
          `  ${enabled + reachable + failed}/${sources.length} processed — enabled=${enabled} reachable=${reachable} failed=${failed} (${elapsed}s)`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(
    `\nDone. enabled=${enabled} reachable-no-mapping=${reachable} failed=${failed} of ${sources.length} in ${elapsed}s`,
  );

  const { count: totalEnabled } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(`\npermit_sources enabled=true now: ${totalEnabled?.toLocaleString() ?? "?"}`);
})();
