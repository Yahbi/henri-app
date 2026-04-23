#!/usr/bin/env npx tsx
/* Verification script for the v2 permit-source integration.
 * Confirms the 8 new sources landed permits and summarizes the DB state. */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const V2_CITIES = [
  "Washington", "Raleigh", "Hartford", "Tempe",
  "Sioux Falls", "Louisville", "Baton Rouge",
];

async function main() {
  console.log("=".repeat(72));
  console.log("  v2 Integration Verification");
  console.log("=".repeat(72));

  const { data: sources } = await supabase
    .from("permit_sources")
    .select("source_key, enabled, last_scraped_at, error_count")
    .like("source_key", "v2_%")
    .order("source_key");

  console.log("\n  permit_sources (v2_*):");
  if (sources) {
    for (const s of sources) {
      console.log(
        `    ${s.source_key.padEnd(32)} enabled=${s.enabled}  errors=${s.error_count ?? 0}  last=${s.last_scraped_at ?? "never"}`
      );
    }
  }

  console.log("\n  permits per v2 city:");
  for (const city of V2_CITIES) {
    const { count } = await supabase
      .from("permits")
      .select("id", { count: "exact", head: true })
      .eq("source_city", city);
    console.log(`    ${city.padEnd(16)} ${count ?? 0}`);
  }

  const { count: total } = await supabase
    .from("permits")
    .select("id", { count: "exact", head: true });
  console.log(`\n  Total permits in DB: ${total ?? "?"}`);

  // Sample a DC row to confirm field mapping worked
  const { data: sample } = await supabase
    .from("permits")
    .select("source_city, permit_number, permit_type, status, address, zip, issued_date, latitude, longitude")
    .in("source_city", V2_CITIES)
    .not("issued_date", "is", null)
    .limit(5);
  if (sample && sample.length) {
    console.log("\n  Sample v2 rows:");
    for (const r of sample) console.log(`    ${JSON.stringify(r)}`);
  }

  console.log("\n" + "=".repeat(72));
}

main().catch((e) => { console.error(e); process.exit(1); });
