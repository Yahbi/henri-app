/**
 * parcels-sidecar reader — falls through here when Regrid + the
 * county-specific GIS adapters in `county-gis.ts` return null for an
 * address in one of the 7 dead-permit states (ME, MS, NH, OK, RI, UT, WV).
 *
 * The sidecar table `parcels_sidecar` is populated by the Hetzner
 * `load_parcels_arcgis.py` loader from the `parcel_sources` registry
 * created in migration 00085. As the Hetzner loader fills the table,
 * this reader starts returning hits for those states.
 *
 * Read path: `enrichFromCounty()` calls this after every other lookup
 * (county-specific + state-aggregator) and before the OSM fallback. The
 * orchestrator handles graceful degrade — when the table is empty (pre-
 * Hetzner), every call returns null and the OSM fallback kicks in.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { ParcelHit } from "./county-gis";

/** State codes that the sidecar covers per migration 00085 seed. */
const SIDECAR_STATES = new Set(["ME", "MS", "NH", "OK", "RI", "UT", "WV"]);

/**
 * Strip trailing ", CITY, STATE ZIP" from a permit address. Mirrors the
 * `stripAddressTrailer` helper in county-gis.ts so the situs_addr LIKE
 * matches against the same normalized form the sidecar loader writes.
 */
function stripTrailer(addr: string): string {
  const commaIdx = addr.indexOf(",");
  return (commaIdx > 0 ? addr.slice(0, commaIdx) : addr).trim().toUpperCase();
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Look up a parcel in `parcels_sidecar` by state + situs address prefix.
 *
 * Returns the most recently ingested matching row, mapped to ParcelHit.
 * Returns null on any error, miss, or unsupported state — the orchestrator
 * uses null as the signal to fall through to the next enrichment source.
 */
export async function queryParcelsSidecar(
  state: string | null,
  address: string,
): Promise<ParcelHit | null> {
  if (!state || !address) return null;
  const stateUp = state.trim().toUpperCase();
  if (!SIDECAR_STATES.has(stateUp)) return null;

  const situsPrefix = stripTrailer(address);
  if (!situsPrefix || situsPrefix.length < 3) return null;

  try {
    const supabase = createAdminClient();
    // Inline select string — multi-line concatenation breaks Supabase's
    // type inference (returns GenericStringError instead of the row type).
    const { data, error } = await supabase
      .from("parcels_sidecar")
      .select("owner_name,owner_mailing_addr,situs_addr,situs_city,situs_zip,recent_transfer_at,total_appraisal,built_year,building_sqft,resident_phone,source_key")
      .eq("state_code", stateUp)
      .ilike("situs_addr", `${situsPrefix}%`)
      .order("ingested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    // Loose-type the row — parcels_sidecar isn't in the generated Database
    // typedef yet (migration 00085 just shipped; types regen lives on
    // a separate ticket). The actual SELECT is column-safe.
    const r = data as Record<string, unknown>;

    const yearBuilt = numOrNull(r.built_year);
    return {
      owner_name: (r.owner_name as string) ?? null,
      mailing_address: (r.owner_mailing_addr as string) ?? null,
      year_built: yearBuilt && yearBuilt >= 1700 && yearBuilt <= 2100 ? yearBuilt : null,
      home_sqft: numOrNull(r.building_sqft),
      assessed_value: numOrNull(r.total_appraisal),
      // recent_transfer_at maps onto last_sale_date — best signal we have
      // for "this parcel just changed hands, lead is hot".
      last_sale_date: typeof r.recent_transfer_at === "string"
        ? r.recent_transfer_at.slice(0, 10)
        : null,
      source: `parcels_sidecar (${r.source_key as string})`,
    };
  } catch {
    return null;
  }
}
