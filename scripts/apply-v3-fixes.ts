#!/usr/bin/env npx tsx
/* Applies 00023_repair_and_expand_permit_sources.sql via the service-role
 * client — useful when the Supabase SQL editor is not handy.
 *
 * Three actions:
 *   A. UPDATE 6 broken field mappings (Austin, Chicago, Cincinnati, Seattle,
 *      SF, v2_baton_rouge).
 *   B. UPDATE 30 dead endpoints to enabled = false.
 *   C. INSERT 3 new v3 sources (NYC DOB permits, NYC DOB jobs, Dallas).
 *
 * Idempotent: safe to re-run. */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Mapping = {
  source_key: string;
  patch: Record<string, string | null>;
};

// Section A — field-mapping repairs
const REPAIRS: Mapping[] = [
  { source_key: "socrata_austin", patch: {
      id_field: "permit_number", type_field: "permittype", status_field: "status_current",
      desc_field: "description", address_field: "permit_location",
      date_field: "applieddate", value_field: "total_job_valuation",
  }},
  { source_key: "socrata_chicago", patch: {
      id_field: "id", type_field: "permit_type", status_field: "permit_type",
      desc_field: "work_description", address_field: "street_name",
      date_field: "issue_date", value_field: "reported_cost",
      lat_field: "latitude", lng_field: "longitude",
  }},
  { source_key: "socrata_cincinnati", patch: {
      id_field: "permitnum", type_field: "permittype", status_field: "statuscurrent",
      desc_field: "description", address_field: "originaladdress1",
      date_field: "applieddate", value_field: "estprojectcostdec",
      lat_field: null, lng_field: null,
  }},
  { source_key: "socrata_seattle", patch: {
      id_field: "permitnum", type_field: "permittypedesc", status_field: "statuscurrent",
      desc_field: "description", address_field: "originaladdress1",
      date_field: "completeddate", value_field: "housingunits",
      lat_field: "latitude", lng_field: "longitude",
  }},
  { source_key: "socrata_sf", patch: {
      id_field: "permit_number", type_field: "permit_type_definition", status_field: "status",
      desc_field: "description", address_field: "street_name",
      date_field: "issued_date", value_field: "estimated_cost",
      lat_field: null, lng_field: null,
  }},
  { source_key: "v2_socrata_baton_rouge", patch: {
      lat_field: null, lng_field: null,
  }},
];

// Section B — disable sources that 404/403/non-JSON on live probe
const DISABLE: string[] = [
  "arcgis_arlington", "arcgis_atlanta", "arcgis_aurora", "arcgis_durham",
  "arcgis_fairfax", "arcgis_houston", "arcgis_knoxville", "arcgis_sanjose",
  "arcgis_stpete", "arcgis_tampa",
  "socrata_baltimore", "socrata_berkeley", "socrata_buffalo",
  "socrata_cleveland", "socrata_denver", "socrata_honolulu",
  "socrata_houston", "socrata_jersey", "socrata_la",
  "socrata_louisville", "socrata_miami_dade", "socrata_milwaukee",
  "socrata_montgomery", "socrata_nashville", "socrata_nola",
  "socrata_nyc", "socrata_phoenix", "socrata_santa_monica",
  "socrata_sd", "socrata_seattle_lu",
];

// Section C — new v3 sources to add
type NewSrc = Record<string, string | null | boolean>;
const NEW_SOURCES: NewSrc[] = [
  {
    source_key: "v3_socrata_nyc_dob", name: "NYC DOB Permits Issued",
    state: "NY", city: "New York", jurisdiction: "NYC Department of Buildings",
    endpoint: "https://data.cityofnewyork.us/resource/ipu4-2q9a.json",
    source_type: "socrata", auth: "socrata_token", update_freq: "daily",
    id_field: "job__", type_field: "permit_type", status_field: "permit_status",
    desc_field: "work_type", address_field: "street_name",
    date_field: "issuance_date", value_field: null,
    lat_field: "gis_latitude", lng_field: "gis_longitude",
  },
  {
    source_key: "v3_socrata_nyc_jobs", name: "NYC DOB Job Applications",
    state: "NY", city: "New York", jurisdiction: "NYC Department of Buildings",
    endpoint: "https://data.cityofnewyork.us/resource/ic3t-wcy2.json",
    source_type: "socrata", auth: "socrata_token", update_freq: "daily",
    id_field: "job__", type_field: "job_type", status_field: "job_status",
    desc_field: "job_description", address_field: "street_name",
    date_field: "latest_action_date", value_field: "initial_cost",
    lat_field: "gis_latitude_", lng_field: "gis_longitude_",
  },
  {
    source_key: "v3_socrata_dallas", name: "Dallas Building Permits",
    state: "TX", city: "Dallas", jurisdiction: "City of Dallas",
    endpoint: "https://www.dallasopendata.com/resource/e7gq-4sah.json",
    source_type: "socrata", auth: "socrata_token", update_freq: "daily",
    id_field: "permit_number", type_field: "permit_type", status_field: "permit_type",
    desc_field: "work_description", address_field: "street_address",
    date_field: "issued_date", value_field: "value",
    lat_field: null, lng_field: null,
  },
];

async function main() {
  console.log("=".repeat(72));
  console.log("  v3 Repair + Expand");
  console.log("=".repeat(72));

  // Section A
  console.log("\n  A. Repairing 6 field mappings...");
  for (const { source_key, patch } of REPAIRS) {
    const { error } = await supabase
      .from("permit_sources")
      .update({ ...patch, error_count: 0 })
      .eq("source_key", source_key);
    console.log(`     ${source_key.padEnd(32)} ${error ? `FAIL ${error.message}` : "OK"}`);
  }

  // Section B
  console.log(`\n  B. Disabling ${DISABLE.length} dead endpoints...`);
  const { error: eB, data: dB } = await supabase
    .from("permit_sources")
    .update({ enabled: false })
    .in("source_key", DISABLE)
    .select("source_key");
  console.log(`     ${eB ? `FAIL ${eB.message}` : `disabled ${dB?.length ?? 0}`}`);

  // Section C
  console.log(`\n  C. Inserting ${NEW_SOURCES.length} new v3 sources...`);
  for (const src of NEW_SOURCES) {
    const { error } = await supabase
      .from("permit_sources")
      .upsert(src, { onConflict: "source_key", ignoreDuplicates: true });
    console.log(`     ${(src.source_key as string).padEnd(32)} ${error ? `FAIL ${error.message}` : "OK"}`);
  }

  // Summary
  const { data: final } = await supabase
    .from("permit_sources")
    .select("source_key, enabled, source_type")
    .order("source_key");

  const enabled = final?.filter((r) => r.enabled) ?? [];
  console.log("\n" + "=".repeat(72));
  console.log(`  Final: ${enabled.length}/${final?.length ?? 0} enabled`);
  console.log(`    socrata: ${enabled.filter((r) => r.source_type === "socrata").length}`);
  console.log(`    arcgis:  ${enabled.filter((r) => r.source_type === "arcgis").length}`);
  console.log("=".repeat(72));
}

main().catch((e) => { console.error(e); process.exit(1); });
