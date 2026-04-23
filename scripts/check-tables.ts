import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function probe(name: string) {
  const { data, error } = await supabase.from(name).select("*").limit(1);
  if (error) {
    return { name, ok: false, err: error.message };
  }
  return { name, ok: true, sampleRow: data?.[0] ?? null, gotRows: (data?.length ?? 0) > 0 };
}

(async () => {
  console.log(JSON.stringify(await probe("zip_reference"), null, 2));
  console.log(JSON.stringify(await probe("address_permit_history"), null, 2));
  // Also test a write
  const { error } = await supabase.from("zip_reference").upsert({
    zipcode: "00000",
    city: "Test",
    county: "Test",
    state: "XX",
    state_fips: "00",
    state_name: "Test",
  });
  console.log("Insert test:", error ? `FAIL ${error.message}` : "OK");
  // Clean up
  await supabase.from("zip_reference").delete().eq("zipcode", "00000");
})();
