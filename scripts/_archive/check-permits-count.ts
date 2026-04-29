import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  const { count: permits } = await supabase.from("permits").select("*", { count: "exact", head: true });
  const { count: unscored } = await supabase.from("permits").select("*", { count: "exact", head: true }).is("scored_at", null);
  const { count: zips } = await supabase.from("zip_reference").select("*", { count: "exact", head: true });
  const { count: sources } = await supabase.from("permit_sources").select("*", { count: "exact", head: true });
  const { count: aph } = await supabase.from("address_permit_history").select("*", { count: "exact", head: true });
  const { count: terr } = await supabase.from("territories").select("*", { count: "exact", head: true });
  const { count: leads } = await supabase.from("leads").select("*", { count: "exact", head: true });
  // Sample a few rows
  const { data: sample } = await supabase.from("permits").select("source_city, source_id, city, state, zip, latitude, longitude, estimated_value, issued_date, source_type").limit(3);
  console.log(JSON.stringify({ permits, unscored, zips, sources, aph, terr, leads, sample }, null, 2));
})();
