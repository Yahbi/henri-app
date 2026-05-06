/**
 * One-shot cleanup — sets error_count=99 (the "platform-unprobeable"
 * sentinel) on rows whose endpoint shape guarantees they can't be
 * probed. Without this, bulk-probe-sources.ts keeps retrying them up
 * to 3 times each, wasting the probe budget.
 *
 * Targets discovered during the 2026-04-22 sweep:
 *   1. ArcGIS Hub *landing* URLs — `https://X.maps.arcgis.com` /
 *      `https://X.arcgis.com` with no `/rest/services/` segment.
 *      997 / 1000 ArcGIS failures in the first sweep were this shape.
 *
 * Run: npx tsx scripts/mark-unprobeable-rows.ts
 * Idempotent — re-running is a no-op once error_count=99 is set.
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

function isArcGISHubLanding(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    const host = u.hostname.toLowerCase();
    const ok =
      host.endsWith(".arcgis.com") ||
      host === "opendata.arcgis.com" ||
      host === "hub.arcgis.com";
    return ok && !/\/rest\/services\//i.test(u.pathname);
  } catch {
    return false;
  }
}

(async () => {
  // Pull every ArcGIS row that hasn't already been flagged unprobeable.
  const PAGE = 1000;
  let offset = 0;
  const landings: string[] = [];
  const all: Array<{ source_key: string; endpoint: string }> = [];
  while (true) {
    const { data, error } = await s
      .from("permit_sources")
      .select("source_key, endpoint")
      .eq("source_type", "arcgis")
      .or("error_count.is.null,error_count.lt.99")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) all.push(r as { source_key: string; endpoint: string });
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`scanned ${all.length.toLocaleString()} arcgis rows`);

  for (const r of all) if (isArcGISHubLanding(r.endpoint)) landings.push(r.source_key);
  console.log(`identified ${landings.length.toLocaleString()} arcgis-hub-landing rows`);

  if (landings.length === 0) {
    console.log("nothing to mark — done");
    return;
  }

  // Small batch — PostgREST GET/PATCH URL encodes the full key list in
  // the query string, and long source_keys (30-200 chars each) blow the
  // URL past typical server limits at batch=500. 50 keys × ~60 chars
  // avg → 3 KB URL, comfortably inside every proxy's limit.
  const BATCH = 50;
  let flagged = 0;
  for (let i = 0; i < landings.length; i += BATCH) {
    const chunk = landings.slice(i, i + BATCH);
    const { error } = await s
      .from("permit_sources")
      .update({ error_count: 99 })
      .in("source_key", chunk);
    if (error) {
      console.warn(`  batch ${i}-${i + BATCH} failed: ${error.message}`);
    } else {
      flagged += chunk.length;
    }
    if ((i / BATCH) % 20 === 0) {
      console.log(`  progress ${flagged.toLocaleString()} / ${landings.length.toLocaleString()}`);
    }
  }
  console.log(`\nmarked ${flagged.toLocaleString()} rows unprobeable`);
})();
