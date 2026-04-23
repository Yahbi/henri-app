#!/usr/bin/env npx tsx
/* ── Seed v2 Permit Sources ──────────────────────────────────────────────────
 * Applies supabase/migrations/00022_seed_permit_sources_v2.sql without
 * needing the Supabase SQL editor — upserts the same 8 rows via the
 * service-role client.
 *
 * Pre-flight: probes every endpoint with a small GET before inserting so we
 * don't pollute permit_sources with URLs that are 404/DNS-fail. Any source
 * that fails the probe is reported and skipped.
 *
 * Usage:
 *   npx tsx scripts/seed-v2-sources.ts               # probe + insert
 *   npx tsx scripts/seed-v2-sources.ts --dry-run     # probe only
 *   npx tsx scripts/seed-v2-sources.ts --force       # insert without probing
 * ────────────────────────────────────────────────────────────────────────── */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

type Src = {
  source_key: string;
  name: string;
  state: string;
  city: string;
  jurisdiction: string;
  endpoint: string;
  source_type: "socrata" | "arcgis";
  auth: string;
  update_freq: string;
  id_field: string;
  type_field: string;
  status_field: string;
  desc_field: string;
  address_field: string;
  date_field: string;
  value_field: string;
  lat_field: string | null;
  lng_field: string | null;
};

// Field mappings corrected against live probe output (see probe-v2-fields.ts).
const SOURCES: Src[] = [
  {
    source_key: "v2_socrata_baton_rouge",
    name: "East Baton Rouge Building Permits",
    state: "LA", city: "Baton Rouge", jurisdiction: "East Baton Rouge Parish",
    endpoint: "https://data.brla.gov/resource/7fq7-8j7r.json",
    source_type: "socrata", auth: "socrata_token", update_freq: "daily",
    // Real Socrata fields: permitid, permitnumber, permittype, designation,
    //   projectdescription, streetaddress, issueddate, projectvalue (no lat/lng cols).
    id_field: "permitnumber", type_field: "permittype", status_field: "designation",
    desc_field: "projectdescription", address_field: "address", date_field: "issueddate",
    value_field: "projectvalue", lat_field: "latitude", lng_field: "longitude",
  },
  {
    source_key: "v2_arcgis_dc_current",
    name: "Washington DC Building Permits (Current Year)",
    state: "DC", city: "Washington", jurisdiction: "District of Columbia DCRA",
    endpoint: "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/17",
    source_type: "arcgis", auth: "none", update_freq: "weekly",
    id_field: "PERMIT_ID", type_field: "PERMIT_TYPE_NAME", status_field: "APPLICATION_STATUS_NAME",
    desc_field: "DESC_OF_WORK", address_field: "FULL_ADDRESS", date_field: "ISSUE_DATE",
    value_field: "FEES_PAID", lat_field: null, lng_field: null,
  },
  {
    source_key: "v2_arcgis_dc_next",
    name: "Washington DC Building Permits (Next Year)",
    state: "DC", city: "Washington", jurisdiction: "District of Columbia DCRA",
    endpoint: "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18",
    source_type: "arcgis", auth: "none", update_freq: "weekly",
    id_field: "PERMIT_ID", type_field: "PERMIT_TYPE_NAME", status_field: "APPLICATION_STATUS_NAME",
    desc_field: "DESC_OF_WORK", address_field: "FULL_ADDRESS", date_field: "ISSUE_DATE",
    value_field: "FEES_PAID", lat_field: null, lng_field: null,
  },
  {
    source_key: "v2_arcgis_wake_county",
    name: "Wake County NC Building Permits",
    state: "NC", city: "Raleigh", jurisdiction: "Wake County NC",
    endpoint: "https://maps.wake.gov/arcgis/rest/services/Inspections/Building_Permits/MapServer/0",
    source_type: "arcgis", auth: "none", update_freq: "weekly",
    id_field: "PERMIT_NUMBER", type_field: "PERMIT_TYPE", status_field: "PERMIT_STATUS",
    desc_field: "DESCRIPTION", address_field: "MAILING_ADDRESS", date_field: "ISSUE_DATE",
    value_field: "VALUATION", lat_field: null, lng_field: null,
  },
  {
    source_key: "v2_arcgis_hartford",
    name: "Hartford CT Building Permits",
    state: "CT", city: "Hartford", jurisdiction: "City of Hartford",
    endpoint: "https://utility.arcgis.com/usrsvcs/servers/d595ae995fb049d3ac54919ebf24b1ac/rest/services/HartfordOpenDataTables/FeatureServer/0",
    source_type: "arcgis", auth: "none", update_freq: "weekly",
    id_field: "RECORD_ID", type_field: "RECORD_TYPE_TYPE", status_field: "RECORD_STATUS",
    desc_field: "DESCRIPTION", address_field: "PROPERTY_ADDRESS", date_field: "DateIssued",
    value_field: "Total_Construction_Cost", lat_field: null, lng_field: null,
  },
  {
    source_key: "v2_arcgis_tempe",
    name: "Tempe AZ Building Permits",
    state: "AZ", city: "Tempe", jurisdiction: "City of Tempe",
    endpoint: "https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/building_permits/FeatureServer/0",
    source_type: "arcgis", auth: "none", update_freq: "weekly",
    id_field: "PermitNum", type_field: "PermitType", status_field: "StatusCurrent",
    desc_field: "Description", address_field: "OriginalAddress1", date_field: "IssuedDate",
    value_field: "EstProjectCost", lat_field: null, lng_field: null,
  },
  {
    source_key: "v2_arcgis_sioux_falls",
    name: "Sioux Falls SD Building Permits",
    state: "SD", city: "Sioux Falls", jurisdiction: "City of Sioux Falls",
    endpoint: "https://gis.siouxfalls.gov/arcgis/rest/services/Data/Community/MapServer/3",
    source_type: "arcgis", auth: "none", update_freq: "weekly",
    id_field: "PERMITNUMBER", type_field: "PERMITTYPE", status_field: "PERMITSTATUS",
    desc_field: "WORKCLASS", address_field: "MAINADDRESS", date_field: "ISSUEDATE",
    value_field: "VALUATION", lat_field: null, lng_field: null,
  },
  {
    source_key: "v2_arcgis_louisville_active",
    name: "Louisville Metro Active Construction Permits",
    state: "KY", city: "Louisville", jurisdiction: "Louisville Metro Government",
    endpoint: "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0",
    source_type: "arcgis", auth: "none", update_freq: "weekly",
    id_field: "PERMIT_NUMBER", type_field: "PERMIT_TYPE", status_field: "PERMIT_STATUS",
    desc_field: "WORK_TYPE", address_field: "ADDRESS", date_field: "ISSUE_DATE",
    value_field: "PROJECT_COSTS", lat_field: null, lng_field: null,
  },
];

/** Probe an endpoint with a tiny request. For ArcGIS we hit /query?f=json&where=1=1&resultRecordCount=1.
 *  For Socrata we hit ?$limit=1. Returns {ok, status, sampleField} to help tune field names. */
async function probe(src: Src): Promise<{ ok: boolean; status: number | string; note: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    let url: string;
    if (src.source_type === "arcgis") {
      url = `${src.endpoint}/query?where=1%3D1&outFields=*&f=json&resultRecordCount=1&returnGeometry=true`;
    } else {
      url = `${src.endpoint}?$limit=1`;
    }
    const res = await fetch(url, {
      headers: { "User-Agent": "Henri/1.0 permit-source-probe" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, status: res.status, note: `HTTP ${res.status}` };
    const body = await res.text();
    // ArcGIS error payloads can return 200 OK with {"error":{...}}
    let json: unknown;
    try { json = JSON.parse(body); } catch { return { ok: false, status: "parse", note: "non-JSON body" }; }
    if (typeof json === "object" && json !== null && "error" in json) {
      const e = (json as { error: { message?: string } }).error;
      return { ok: false, status: "error", note: e?.message ?? "arcgis error" };
    }
    if (src.source_type === "arcgis") {
      const features = (json as { features?: unknown[] }).features ?? [];
      const attrs = (features[0] as { attributes?: Record<string, unknown> } | undefined)?.attributes ?? {};
      const keys = Object.keys(attrs).slice(0, 6).join(",");
      return { ok: true, status: res.status, note: `features=${features.length} fields=[${keys}...]` };
    } else {
      const arr = json as unknown[];
      const keys = typeof arr[0] === "object" && arr[0] !== null ? Object.keys(arr[0] as object).slice(0, 6).join(",") : "";
      return { ok: true, status: res.status, note: `rows=${arr.length} fields=[${keys}...]` };
    }
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: "fetch", note: msg };
  }
}

async function main() {
  console.log("=".repeat(72));
  console.log(`  Seed v2 Permit Sources  (${SOURCES.length} candidates)`);
  console.log("=".repeat(72));

  const live: Src[] = [];
  const dead: { src: Src; note: string }[] = [];

  if (FORCE) {
    console.log("\n  --force supplied → skipping pre-flight probes.\n");
    live.push(...SOURCES);
  } else {
    console.log("\n  Pre-flight probes (20s timeout each):\n");
    for (const src of SOURCES) {
      process.stdout.write(`    ${src.source_key.padEnd(32)} `);
      const r = await probe(src);
      if (r.ok) {
        console.log(`OK (${r.status})  ${r.note}`);
        live.push(src);
      } else {
        console.log(`FAIL (${r.status})  ${r.note}`);
        dead.push({ src, note: r.note });
      }
    }
  }

  console.log(`\n  Summary: ${live.length} live, ${dead.length} dead\n`);

  if (DRY) {
    console.log("  --dry-run → not inserting.");
    process.exit(0);
  }

  if (live.length === 0) {
    console.log("  No live sources to insert. Exiting.");
    process.exit(1);
  }

  console.log(`  Upserting ${live.length} rows into permit_sources...`);
  const { error, data } = await supabase
    .from("permit_sources")
    .upsert(live, { onConflict: "source_key", ignoreDuplicates: true })
    .select("source_key, enabled");

  if (error) {
    console.error("  Upsert failed:", error);
    process.exit(1);
  }
  console.log(`  Upsert OK. ${data?.length ?? 0} row(s) affected.`);
  if (data) {
    for (const r of data) console.log(`    ${r.source_key}  enabled=${r.enabled}`);
  }

  if (dead.length > 0) {
    console.log("\n  Skipped (failed probe):");
    for (const { src, note } of dead) {
      console.log(`    ${src.source_key}  — ${note}`);
    }
    console.log("\n  Re-run with --force to insert anyway (will increment error_count on scrape).");
  }

  // Confirm final state
  const { data: final, error: qerr } = await supabase
    .from("permit_sources")
    .select("source_key, enabled, last_scraped_at")
    .like("source_key", "v2_%")
    .order("source_key");

  if (!qerr && final) {
    console.log(`\n  Final v2_* rows in permit_sources: ${final.length}`);
    for (const r of final) {
      console.log(`    ${r.source_key.padEnd(32)} enabled=${r.enabled} last=${r.last_scraped_at ?? "never"}`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("  Done. Next: trigger scrape via:");
  console.log("    curl -X POST -H \"Authorization: Bearer $CRON_SECRET\" http://localhost:3000/api/cron/scrape");
  console.log("=".repeat(72));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
