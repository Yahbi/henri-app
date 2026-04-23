import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  // Mirror useLeads pagination for limit=2000 with geocoded_only filter
  const PAGE_SIZE = 1000;
  const limit = 2000;
  const startOffset = 0;
  const data: unknown[] = [];
  for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
    const take = Math.min(PAGE_SIZE, limit - offset);
    const t0 = Date.now();
    const { data: rows, error } = await s
      .from("leads")
      .select("id, score, urgency, status, latitude, longitude, permits!inner(address, state, latitude)")
      .eq("contractor_id", owner!.id)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("score", { ascending: false })
      .range(startOffset + offset, startOffset + offset + take - 1);
    const ms = Date.now() - t0;
    if (error) {
      console.log(`page ${offset}: ERROR ${error.message} in ${ms}ms`);
      break;
    }
    console.log(`page ${offset}: got ${rows?.length ?? 0} rows in ${ms}ms`);
    data.push(...(rows ?? []));
    if (!rows || rows.length < take) break;
  }
  console.log(`\nTotal: ${data.length} leads`);
})();
