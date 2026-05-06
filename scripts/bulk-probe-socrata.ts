/**
 * Socrata-only bulk probe.
 *
 * The generic `bulk-probe-sources.ts` runs against arcgis + socrata + ckan
 * + csv, and gets ~0.4% enable yield because most ArcGIS Hub catalog rows
 * are landing pages that don't expose `?f=json`. Socrata datasets, in
 * contrast, have 90%+ probe success rate when the dataset_id is real
 * — every `https://<host>/resource/<9-char-id>.json` either returns JSON
 * or 404s.
 *
 * This script narrows the candidate pool to source_type='socrata' AND
 * matches the canonical Socrata URL shape, then probes them with the
 * shared `probeSource` helper.
 *
 * Usage:
 *   npx tsx scripts/bulk-probe-socrata.ts          # 1000 candidates
 *   PROBE_LIMIT=5000 npx tsx scripts/bulk-probe-socrata.ts
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

const STATE_PRIORITY = [
  "CA","TX","FL","NY","IL","WA","OR","CO","AZ","MA",
  "NJ","VA","GA","PA","OH","NC","CT","MD","DC","NV",
];

const SOCRATA_RE = /^https:\/\/[^/]+\/resource\/[a-z0-9]{4}-[a-z0-9]{4}\.json/i;

(async () => {
  // Pull Socrata candidates — paginate via .range() because PostgREST
  // caps single-response selects at 1000 rows.
  const PAGE = 1000;
  const sources: Array<{ source_key: string; name: string; state: string; source_type: string; endpoint: string }> = [];
  let offset = 0;
  while (sources.length < LIMIT) {
    const take = Math.min(PAGE, LIMIT - sources.length);
    const { data, error } = await s
      .from("permit_sources")
      .select("source_key, name, state, source_type, endpoint")
      .eq("source_type", "socrata")
      .eq("enabled", false)
      .or("error_count.is.null,error_count.lt.3")
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .range(offset, offset + take - 1);
    if (error) {
      console.error("scan error:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    // Filter to canonical Socrata URLs at the JS layer — Postgres LIKE
    // would also work but doesn't compose with the existing ordering.
    for (const row of data) {
      if (SOCRATA_RE.test(row.endpoint)) {
        sources.push(row as typeof sources[number]);
      }
    }
    offset += take;
    if (data.length < take) break;
  }

  if (!sources.length) {
    console.log("no Socrata candidates left");
    return;
  }

  // Sort priority states first.
  sources.sort((a, b) => {
    const pa = STATE_PRIORITY.indexOf(a.state);
    const pb = STATE_PRIORITY.indexOf(b.state);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });

  console.log(`probing ${sources.length} Socrata candidates, concurrency ${CONCURRENCY}`);

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
            const { data: cur } = await s
              .from("permit_sources")
              .select("error_count")
              .eq("source_key", row.source_key)
              .single();
            patch.error_count = (cur?.error_count ?? 0) + 1;
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
