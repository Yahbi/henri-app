/**
 * Truth probe for the leads table schema. Queries `SELECT * FROM leads
 * LIMIT 1` to get the canonical column list — bypasses the curl/bash
 * escaping issues that made the previous bash audit report ghost-MISSING
 * columns.
 *
 * Read-only.
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

async function main() {
  const { data, error } = await s.from("leads").select("*").limit(1);
  if (error) throw error;
  if (!data || data.length === 0) {
    console.log("no leads in DB");
    return;
  }
  const cols = Object.keys(data[0]).sort();
  console.log(`leads has ${cols.length} columns:`);
  console.log(cols.join("\n"));

  // Cross-check the columns we expected from migrations 00039/00044/00045.
  const expected = [
    // 00019
    "address", "city", "state", "zip", "permit_type", "permit_value", "latitude", "longitude",
    // 00039
    "contact_source", "contact_confidence", "contact_extracted_at",
    // 00044
    "employer", "occupation", "business_phone", "business_status", "business_website",
    "license_number", "license_status", "naics_code",
    // 00045
    "cross_trade_suggestions",
    // 00051
    "last_enriched_at",
    // pre-existing (Lead type fields)
    "email", "mailing_address", "owner_since", "co_owner", "year_built", "property_value",
  ];
  console.log(`\nExpected-vs-actual:`);
  for (const e of expected) {
    const present = cols.includes(e);
    console.log(`  ${present ? "OK   " : "MISS "} ${e}`);
  }

  // Same for permits
  const { data: pdata, error: perr } = await s.from("permits").select("*").limit(1);
  if (perr) throw perr;
  if (pdata && pdata.length > 0) {
    const pcols = Object.keys(pdata[0]).sort();
    console.log(`\npermits has ${pcols.length} columns:`);
    console.log(pcols.join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
