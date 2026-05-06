import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  console.log("=== LEAD VISIBILITY PROBE ===\n");
  // Find the dev god-mode contractor
  const { data: prof } = await s.from("profiles").select("id, email, role").eq("email", "y.abismuth@gmail.com").single();
  console.log("Dev contractor:", prof?.id, "/", prof?.email, "/ role:", prof?.role);
  // Total leads
  const { count: total } = await s.from("leads").select("*", { count: "planned", head: true });
  console.log("Total leads in DB:", total?.toLocaleString());
  // Owned by dev
  const { count: ownedByDev } = await s.from("leads").select("*", { count: "planned", head: true }).eq("contractor_id", prof?.id);
  console.log("Owned by dev contractor:", ownedByDev?.toLocaleString());
  // NULL contractor_id (unassigned)
  const { count: unassigned } = await s.from("leads").select("*", { count: "planned", head: true }).is("contractor_id", null);
  console.log("Unassigned (contractor_id IS NULL):", unassigned?.toLocaleString());
  // Distinct other-contractor count
  const { data: others } = await s.from("leads").select("contractor_id").not("contractor_id", "is", null).neq("contractor_id", prof?.id || "00000000-0000-0000-0000-000000000000").limit(2000);
  const otherContractors = new Set((others ?? []).map(r => (r as { contractor_id: string }).contractor_id));
  console.log("Other contractors with leads (in 2k sample):", otherContractors.size);
  // List up to 5 other contractor profiles
  if (otherContractors.size > 0) {
    const { data: profs } = await s.from("profiles").select("id, email, role").in("id", Array.from(otherContractors).slice(0, 5));
    console.log("Sample other-contractor profiles:");
    for (const p of profs ?? []) console.log("  ", p);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
