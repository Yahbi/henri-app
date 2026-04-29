import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  const t0 = Date.now();
  // Mirror useLeads first page with the new filter on leads.latitude
  const { data, error } = await s
    .from("leads")
    .select("id, latitude, longitude, score, permits!inner(address, state)")
    .eq("contractor_id", owner!.id)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("score", { ascending: false })
    .range(0, 999);
  const ms = Date.now() - t0;
  console.log({ ms, rows: data?.length, error: error?.message, sample: data?.[0] });
})();
