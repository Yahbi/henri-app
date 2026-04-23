import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();

  // Strategy: use range predicate on latitude to force index use.
  const t0 = Date.now();
  const { data, error } = await s
    .from("leads")
    .select("id, score, latitude, longitude")
    .eq("contractor_id", owner!.id)
    .gte("latitude", -90)
    .lte("latitude", 90)
    .order("score", { ascending: false })
    .range(0, 999);
  const ms = Date.now() - t0;
  console.log({ strat: "range+score sort", rows: data?.length, ms, error: error?.message });

  // Strategy 2: filter by latitude, no score order (use index order)
  const t1 = Date.now();
  const { data: d2, error: e2 } = await s
    .from("leads")
    .select("id, score, latitude, longitude")
    .eq("contractor_id", owner!.id)
    .not("latitude", "is", null)
    .range(0, 999);
  const ms2 = Date.now() - t1;
  console.log({ strat: "not null, no order", rows: d2?.length, ms: ms2, error: e2?.message });
})();
