#!/usr/bin/env npx tsx
/* Dump full attribute/column list from each v2 endpoint so we can tune
 * field mappings before seeding permit_sources. */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

const ENDPOINTS: { key: string; type: "arcgis" | "socrata"; url: string }[] = [
  { key: "v2_socrata_baton_rouge",      type: "socrata", url: "https://data.brla.gov/resource/7fq7-8j7r.json" },
  { key: "v2_arcgis_dc_current",        type: "arcgis",  url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/17" },
  { key: "v2_arcgis_dc_next",           type: "arcgis",  url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18" },
  { key: "v2_arcgis_wake_county",       type: "arcgis",  url: "https://maps.wake.gov/arcgis/rest/services/Inspections/Building_Permits/MapServer/0" },
  { key: "v2_arcgis_hartford",          type: "arcgis",  url: "https://utility.arcgis.com/usrsvcs/servers/d595ae995fb049d3ac54919ebf24b1ac/rest/services/HartfordOpenDataTables/FeatureServer/0" },
  { key: "v2_arcgis_tempe",             type: "arcgis",  url: "https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/building_permits/FeatureServer/0" },
  { key: "v2_arcgis_sioux_falls",       type: "arcgis",  url: "https://gis.siouxfalls.gov/arcgis/rest/services/Data/Community/MapServer/3" },
  { key: "v2_arcgis_louisville_active", type: "arcgis",  url: "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0" },
];

async function run() {
  for (const ep of ENDPOINTS) {
    console.log("\n" + "=".repeat(72));
    console.log(`  ${ep.key}`);
    console.log("=".repeat(72));
    try {
      const url = ep.type === "arcgis"
        ? `${ep.url}/query?where=1%3D1&outFields=*&f=json&resultRecordCount=2&returnGeometry=true`
        : `${ep.url}?$limit=2`;
      const res = await fetch(url, { headers: { "User-Agent": "Henri/1.0 probe" } });
      const json = await res.json() as any;
      if (ep.type === "arcgis") {
        const fields = json.fields as Array<{ name: string; type: string; alias?: string }> | undefined;
        if (fields) {
          console.log(`  Fields (${fields.length}):`);
          for (const f of fields) console.log(`    ${f.name.padEnd(40)} ${f.type} ${f.alias ? `"${f.alias}"` : ""}`);
        }
        const row = json.features?.[0]?.attributes;
        if (row) {
          console.log(`  Sample row 1 (attributes):`);
          for (const [k, v] of Object.entries(row).slice(0, 25)) {
            console.log(`    ${k.padEnd(40)} ${JSON.stringify(v)?.slice(0, 80)}`);
          }
        }
        const geom = json.features?.[0]?.geometry;
        console.log(`  Geometry: ${geom ? JSON.stringify(geom).slice(0, 100) : "none"}`);
      } else {
        const row0 = json[0];
        if (row0) {
          console.log(`  Sample row 1 keys (${Object.keys(row0).length}):`);
          for (const [k, v] of Object.entries(row0)) {
            console.log(`    ${k.padEnd(40)} ${JSON.stringify(v)?.slice(0, 80)}`);
          }
        }
      }
    } catch (e) {
      console.log(`  ERROR: ${e instanceof Error ? e.message : e}`);
    }
  }
}

run();
