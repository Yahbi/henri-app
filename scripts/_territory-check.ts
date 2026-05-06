import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const { data: prof } = await s.from("profiles").select("id, email, plan, role").eq("email", "y.abismuth@gmail.com").single();
  console.log("Profile:", prof);
  const { data: terr, count } = await s.from("territories").select("zip", { count: "exact" }).eq("contractor_id", prof?.id || "");
  console.log("\nTerritories claimed by dev:", count);
  console.log("ZIPs:", (terr ?? []).map(t => (t as {zip:string}).zip).join(", "));
  // Distribution of leads owned by dev BY zip
  const { data: zipDist } = await s.from("leads").select("zip").eq("contractor_id", prof?.id || "").limit(50000);
  const zipMap = new Map<string, number>();
  for (const r of zipDist ?? []) {
    const z = (r as {zip:string|null}).zip ?? "(null)";
    zipMap.set(z, (zipMap.get(z)??0)+1);
  }
  const top = Array.from(zipMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 15);
  console.log("\nTop ZIPs in dev's leads (50k sample):");
  for (const [z, n] of top) console.log("  " + z + " : " + n.toLocaleString());
  console.log("  (" + zipMap.size + " distinct ZIPs in sample)");
}
main();
