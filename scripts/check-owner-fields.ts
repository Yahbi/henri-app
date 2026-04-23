import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  const [total, withOwner, withPhone, withEmail, withOwnerFirst] = await Promise.all([
    s.from("leads").select("id", { count: "exact", head: true }).eq("contractor_id", owner!.id),
    s.from("leads").select("id", { count: "exact", head: true }).eq("contractor_id", owner!.id).not("owner_name", "is", null),
    s.from("leads").select("id", { count: "exact", head: true }).eq("contractor_id", owner!.id).not("phone", "is", null),
    s.from("leads").select("id", { count: "exact", head: true }).eq("contractor_id", owner!.id).not("email", "is", null),
    s.from("leads").select("id", { count: "exact", head: true }).eq("contractor_id", owner!.id).not("owner_first", "is", null),
  ]);
  const { data: sample } = await s.from("leads").select("id, owner_name, owner_first, phone, email, cascade_flag, cascade_count, pipeline_value, score_freshness").eq("contractor_id", owner!.id).not("owner_name", "is", null).limit(1);
  console.log(JSON.stringify({
    total: total.count,
    withOwner: withOwner.count,
    withPhone: withPhone.count,
    withEmail: withEmail.count,
    withOwnerFirst: withOwnerFirst.count,
    sampleWithOwner: sample?.[0] ?? null,
  }, null, 2));
})();
