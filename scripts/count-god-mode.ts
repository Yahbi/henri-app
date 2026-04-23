import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  // Total geocoded leads for owner
  const { count: geocodedTotal } = await s
    .from("leads")
    .select("*, permits!inner(latitude)", { count: "exact", head: true })
    .eq("contractor_id", owner!.id)
    .not("permits.latitude", "is", null);
  const { count: totalAll } = await s
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("contractor_id", owner!.id);
  console.log(JSON.stringify({
    ownerTotalLeads: totalAll,
    ownerGeocodedLeads: geocodedTotal,
    godModeDashboardLimit: "5000 (geocoded_only filter)",
    godModeMapLimit: "25,000",
    subscriberDashboardLimit: "500 (geocoded_only)",
    subscriberMapLimit: "2,000",
  }, null, 2));
})();
