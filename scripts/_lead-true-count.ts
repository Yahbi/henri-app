import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const t0 = Date.now();
  console.log("Running EXACT count (no filter)...");
  const { count: exactTotal, error: e1 } = await s.from("leads").select("*", { count: "exact", head: true });
  console.log("  exact total (any contractor):", exactTotal?.toLocaleString(), "in", Date.now()-t0, "ms", e1?.message ? "ERR " + e1.message : "");
  const t1 = Date.now();
  console.log("\nRunning EXACT count for dev contractor...");
  const { data: prof } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  const { count: exactDev, error: e2 } = await s.from("leads").select("*", { count: "exact", head: true }).eq("contractor_id", prof?.id || "");
  console.log("  exact dev-owned:", exactDev?.toLocaleString(), "in", Date.now()-t1, "ms", e2?.message ? "ERR " + e2.message : "");
  const t2 = Date.now();
  console.log("\nRunning EXACT count for dev contractor + geocoded...");
  const { count: exactDevGeo, error: e3 } = await s.from("leads").select("*", { count: "exact", head: true }).eq("contractor_id", prof?.id || "").not("latitude", "is", null).not("longitude", "is", null);
  console.log("  exact dev-owned + geocoded:", exactDevGeo?.toLocaleString(), "in", Date.now()-t2, "ms", e3?.message ? "ERR " + e3.message : "");
}
main();
