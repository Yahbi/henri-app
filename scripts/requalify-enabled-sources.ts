/**
 * Requalifier: re-scan every `enabled=true` row in permit_sources
 * against the current (tightened) probe heuristics. If a row no longer
 * passes the topical gate, flip `enabled=false` and mark
 * `error_count=50` (off-topic sentinel) so later sweeps skip it.
 *
 * Why: Phase 5a widened the field-name heuristic too aggressively.
 * Smoke-testing the production scraper surfaced five "enabled"
 * sources — CA water boundaries, NWS watches, park-and-ride, air
 * districts — that happen to ship `objectid + address` columns but
 * aren't permit data. The probe now also requires a permit-topic
 * keyword in the endpoint URL / dataset name / column list; this
 * script propagates that gate back to the catalog.
 *
 * Safe to re-run. Read-heavy, write-light (only flips rows that
 * actually need re-quarantining).
 */
import { createClient } from "@supabase/supabase-js";
import { probeSource } from "@/lib/sources/probe";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const OFF_TOPIC_SENTINEL = 50;
const CONCURRENCY = 10;

async function mapPool<T, R>(items: T[], fn: (t: T) => Promise<R>, n: number): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

(async () => {
  // Page through all enabled rows — PostgREST default select cap is 1000.
  const rows: Array<{
    source_key: string;
    source_type: string;
    endpoint: string;
    city: string | null;
    state: string | null;
  }> = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await s
      .from("permit_sources")
      .select("source_key, source_type, endpoint, city, state")
      .eq("enabled", true)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Re-probing ${rows.length.toLocaleString()} currently-enabled sources...`);

  let kept = 0;
  let demoted = 0;
  let unreachable = 0;
  const t0 = Date.now();

  await mapPool(
    rows,
    async (row) => {
      let result;
      try {
        result = await probeSource(row.source_type, row.endpoint);
      } catch {
        unreachable++;
        return;
      }
      if (!result.reachable) {
        // endpoint dead — leave alone (existing error_count tracking
        // owns this state; we only own the topical-gate demotion here).
        unreachable++;
        return;
      }
      if (result.ok) {
        kept++;
        return;
      }
      // Was enabled, no longer passes tightened gate → quarantine.
      await s
        .from("permit_sources")
        .update({ enabled: false, error_count: OFF_TOPIC_SENTINEL })
        .eq("source_key", row.source_key);
      demoted++;
    },
    CONCURRENCY,
  );

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`  kept enabled:         ${kept.toLocaleString()}`);
  console.log(`  demoted (off-topic):  ${demoted.toLocaleString()}`);
  console.log(`  unreachable/unknown:  ${unreachable.toLocaleString()}`);
})();
