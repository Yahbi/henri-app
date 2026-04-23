import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrichFromCounty } from "@/lib/enrichment/county-gis";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Property-enrichment cron. Runs the free county-GIS lookup against leads
 * that are missing owner/year_built/sqft/assessed_value data, writing the
 * results back to the `leads` table.
 *
 * Coverage today: Hartford CT, Los Angeles CA, Miami-Dade FL. Add more in
 * `src/lib/enrichment/county-gis.ts` — each new jurisdiction unlocks its
 * entire permit inventory.
 *
 * This is gated by CRON_SECRET like the scoring cron. Runs every 30 min,
 * processes 100 leads per invocation (~2 req/sec against county servers).
 */

const BATCH_SIZE = 100;

// Polite rate limit — county GIS servers are free, don't hammer them.
const REQ_INTERVAL_MS = 500;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const t0 = Date.now();

  // Pick leads that are missing key property data. Ordering by created_at
  // DESC so we enrich the newest (most actionable) leads first.
  //
  // Not filtering on state — OpenStreetMap provides nationwide fallback
  // coverage, so even leads outside our specialized jurisdictions can get
  // year_built / levels from OSM. Leads in CT, CA (LA), or NYC get the
  // richer endpoints (owner, sqft, sales, etc.) automatically via the
  // COUNTY_LOOKUPS registry in lib/enrichment/county-gis.ts.
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, address, city, state, zip, year_built, home_sqft, assessed_value, owner_name")
    .is("year_built", null)
    .not("address", "is", null)
    .order("created_at", { ascending: false })
    .limit(BATCH_SIZE);

  if (error) {
    logger.error("Enrich cron scan error", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let enriched = 0;
  let missed = 0;

  for (const lead of leads ?? []) {
    const hit = await enrichFromCounty(
      lead.state as string | null,
      lead.city as string | null, // proxy for county in our schema
      lead.address as string,
      lead.zip as string | null,
    );

    if (hit && (hit.owner_name || hit.year_built || hit.home_sqft)) {
      // Only overwrite fields where we have a new value — don't clobber
      // existing data (e.g., a real owner_name from raw_json) with null.
      const patch: Record<string, unknown> = {};
      if (hit.owner_name && !lead.owner_name) patch.owner_name = hit.owner_name;
      if (hit.owner_first) patch.owner_first = hit.owner_first;
      if (hit.owner_last) patch.owner_last = hit.owner_last;
      if (hit.year_built != null) patch.year_built = hit.year_built;
      if (hit.home_sqft != null) patch.home_sqft = String(hit.home_sqft);
      if (hit.lot_sqft != null) patch.lot_sqft = String(hit.lot_sqft);
      if (hit.assessed_value != null) patch.assessed_value = hit.assessed_value;
      if (hit.property_value != null) patch.property_value = hit.property_value;
      if (hit.owner_occupied != null) patch.owner_occupied = hit.owner_occupied;

      if (Object.keys(patch).length > 0) {
        const { error: upErr } = await supabase.from("leads").update(patch).eq("id", lead.id);
        if (!upErr) enriched++;
        else missed++;
      }
    } else {
      missed++;
    }

    // Polite pacing against the free public endpoints.
    await new Promise((r) => setTimeout(r, REQ_INTERVAL_MS));

    if (Date.now() - t0 > 280_000) break;
  }

  return NextResponse.json({
    success: true,
    summary: {
      scanned: leads?.length ?? 0,
      enriched,
      missed,
      elapsedMs: Date.now() - t0,
    },
  });
}
