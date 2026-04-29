#!/usr/bin/env npx tsx
/* Scrape ONE permit_source by source_key. Use after editing a scraper
 * to verify it works before triggering the full cron. */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { scrapeArcGISSource } from "../src/lib/scrapers/arcgis";
import { scrapeSocrataSource } from "../src/lib/scrapers/socrata";

const KEY = process.argv[2];
if (!KEY) {
  console.error("Usage: npx tsx scripts/test-one-source.ts <source_key>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data, error } = await supabase
    .from("permit_sources")
    .select("*")
    .eq("source_key", KEY)
    .single();

  if (error || !data) {
    console.error("Source not found:", error);
    process.exit(1);
  }

  console.log(`Scraping ${data.source_key} (${data.source_type})...`);
  console.log(`  endpoint: ${data.endpoint}`);

  const src = {
    source_key: data.source_key,
    city: data.city,
    state: data.state,
    endpoint: data.endpoint,
    // socrata shape
    idField: data.id_field, typeField: data.type_field, statusField: data.status_field,
    descField: data.desc_field, addressField: data.address_field, dateField: data.date_field,
    valueField: data.value_field, latField: data.lat_field, lngField: data.lng_field,
    // arcgis shape
    id_field: data.id_field, type_field: data.type_field, status_field: data.status_field,
    desc_field: data.desc_field, address_field: data.address_field, date_field: data.date_field,
    value_field: data.value_field,
  };

  const before = Date.now();
  const result = data.source_type === "arcgis"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await scrapeArcGISSource(src as any, 2) // cap to 2 pages = 2000 rows for the test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : await scrapeSocrataSource(src as any, 100); // 100 rows for socrata test
  const took = ((Date.now() - before) / 1000).toFixed(1);

  console.log(`\nResult (${took}s):`, result);

  const { count: cnt } = await supabase
    .from("permits")
    .select("id", { count: "exact", head: true })
    .eq("source_city", data.city);
  console.log(`\nPermits in DB with source_city='${data.city}': ${cnt ?? "unknown"}`);

  const { data: sample } = await supabase
    .from("permits")
    .select("source_id, permit_number, permit_type, status, address, zip, issued_date, latitude, longitude")
    .eq("source_city", data.city)
    .order("created_at", { ascending: false })
    .limit(3);
  if (sample && sample.length) {
    console.log("\nMost recent rows:");
    for (const r of sample) console.log(" ", JSON.stringify(r));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
