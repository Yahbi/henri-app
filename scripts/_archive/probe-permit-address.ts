/**
 * Ad-hoc: find what an address looks like in the permits table so we
 * can calibrate the /api/permits/history prefix match.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  const { data, error } = await s
    .from("permits")
    .select("id, address, zip, permit_type, issued_date")
    .ilike("address", "%ALBANY%")
    .limit(10);
  if (error) throw new Error(error.message);
  console.log(`Matches for ILIKE %ALBANY% (10 max):`);
  for (const p of data ?? []) {
    console.log(`  ${p.address}   zip=${p.zip}   type=${p.permit_type}   issued=${p.issued_date}`);
  }

  const { data: zipData } = await s
    .from("permits")
    .select("id, address, zip")
    .eq("zip", "06112")
    .limit(5);
  console.log(`\nSamples in zip 06112 (first 5):`);
  for (const p of zipData ?? []) {
    console.log(`  ${p.address}   zip=${p.zip}`);
  }
})();
