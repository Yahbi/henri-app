import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  const { data: owner } = await s.from("profiles").select("id, role, plan").eq("email", "y.abismuth@gmail.com").single();
  const [zips, sources, aph, territories, ownerTerritories, permits, permitsUnscored, leads, ownerLeads] = await Promise.all([
    s.from("zip_reference").select("*", { count: "estimated", head: true }),
    s.from("permit_sources").select("*", { count: "estimated", head: true }),
    s.from("address_permit_history").select("*", { count: "estimated", head: true }),
    s.from("territories").select("*", { count: "estimated", head: true }),
    s.from("territories").select("*", { count: "estimated", head: true }).eq("contractor_id", owner!.id).eq("status", "active"),
    s.from("permits").select("*", { count: "estimated", head: true }),
    s.from("permits").select("*", { count: "estimated", head: true }).is("scored_at", null),
    s.from("leads").select("*", { count: "estimated", head: true }),
    s.from("leads").select("*", { count: "estimated", head: true }).eq("contractor_id", owner!.id),
  ]);
  console.log("─ DATA HEALTH ─");
  console.log(JSON.stringify({
    owner: { email: "y.abismuth@gmail.com", role: owner!.role, plan: owner!.plan },
    tables: {
      zip_reference: zips.count,
      permit_sources: sources.count,
      address_permit_history: aph.count,
      territories_total: territories.count,
      territories_owner: ownerTerritories.count,
      permits_total: permits.count,
      permits_unscored_remaining: permitsUnscored.count,
      leads_total: leads.count,
      leads_owner: ownerLeads.count,
    },
  }, null, 2));
})();
