import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  const { count: total } = await s.from("leads").select("*", { count: "exact", head: true }).eq("contractor_id", owner!.id);
  const { count: withCoords } = await s.from("leads").select("*", { count: "exact", head: true }).eq("contractor_id", owner!.id).not("latitude", "is", null);
  const { count: with30d } = await s.from("leads").select("*", { count: "exact", head: true }).eq("contractor_id", owner!.id).gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
  console.log({ ownerId: owner!.id, total, withCoords, with30d });
})();
