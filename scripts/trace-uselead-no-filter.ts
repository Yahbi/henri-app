import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  // Test the new query shape: no geocoded_only, LEFT JOIN permits
  const t0 = Date.now();
  const { data, error } = await s
    .from("leads")
    .select("id, score, latitude, longitude, permits(address, state)")
    .eq("contractor_id", owner!.id)
    .order("score", { ascending: false })
    .range(0, 999);
  const ms = Date.now() - t0;
  const withCoords = (data ?? []).filter((l: any) => l.latitude != null).length;
  console.log({ rows: data?.length, withCoords, ms, error: error?.message });
  // Second page
  const t1 = Date.now();
  const { data: page2, error: e2 } = await s
    .from("leads")
    .select("id, score, latitude, longitude, permits(address)")
    .eq("contractor_id", owner!.id)
    .order("score", { ascending: false })
    .range(1000, 1999);
  const ms2 = Date.now() - t1;
  console.log({ page2: page2?.length, ms2, error: e2?.message });
})();
