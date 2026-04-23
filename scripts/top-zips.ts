#!/usr/bin/env npx tsx
/* Report top ZIPs by permit volume so we know which territories to claim. */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Supabase returns geography columns as opaque binary; check location IS NOT NULL
  // instead of relying on the value in JS. Fetch zips in two queries.
  const { data: allData, error: e1 } = await supabase
    .from("permits")
    .select("zip")
    .not("zip", "is", null)
    .limit(5000);
  const { data: geoData, error: e2 } = await supabase
    .from("permits")
    .select("zip")
    .not("zip", "is", null)
    .not("location", "is", null)
    .limit(5000);
  const error = e1 || e2;
  const data = allData;

  if (error) {
    console.error(error);
    process.exit(1);
  }

  const all: Record<string, number> = {};
  const geocoded: Record<string, number> = {};
  for (const p of data || []) all[p.zip] = (all[p.zip] || 0) + 1;
  for (const p of geoData || []) geocoded[p.zip] = (geocoded[p.zip] || 0) + 1;

  const top = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log("Top 20 ZIPs by permit count:");
  console.log("  ZIP     All    Geocoded");
  for (const [zip, c] of top) {
    console.log(`  ${zip}   ${String(c).padStart(4)}   ${String(geocoded[zip] || 0).padStart(4)}`);
  }
  console.log(`\nTotal permits with ZIP: ${data?.length}`);
  console.log(`Unique ZIPs: ${Object.keys(all).length}`);
}

main();
