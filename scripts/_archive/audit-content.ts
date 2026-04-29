import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function count(table: string, opts?: { filter?: (q: any) => any }) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (opts?.filter) q = opts.filter(q);
  const { count, error } = await q;
  return error ? `err: ${error.message}` : count;
}

(async () => {
  const { data: owner } = await supabase.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  const ownerId = owner?.id;
  const result: Record<string, unknown> = {
    zip_reference: await count("zip_reference"),
    permit_sources: await count("permit_sources"),
    permit_sources_enabled: await count("permit_sources", { filter: q => q.eq("enabled", true) }),
    permits: await count("permits"),
    permits_unscored: await count("permits", { filter: q => q.is("scored_at", null) }),
    permits_30d: await count("permits", { filter: q => q.gte("issued_date", new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)) }),
    address_permit_history: await count("address_permit_history"),
    aph_cascade_candidates: await count("address_permit_history", { filter: q => q.gte("permit_count", 2) }),
    territories_owner: await count("territories", { filter: q => q.eq("contractor_id", ownerId).eq("status", "active") }),
    leads_total: await count("leads"),
    leads_owner: await count("leads", { filter: q => q.eq("contractor_id", ownerId) }),
    leads_owner_cascade: await count("leads", { filter: q => q.eq("contractor_id", ownerId).eq("cascade_flag", true) }),
    leads_owner_hot: await count("leads", { filter: q => q.eq("contractor_id", ownerId).eq("urgency", "hot") }),
    leads_owner_warm: await count("leads", { filter: q => q.eq("contractor_id", ownerId).eq("urgency", "warm") }),
  };
  // Sample lead with history
  const { data: sample } = await supabase
    .from("leads")
    .select("id, score, urgency, cascade_flag, cascade_count, pipeline_value, permit_history, address, city, state, zip")
    .eq("contractor_id", ownerId)
    .eq("cascade_flag", true)
    .limit(1);
  console.log(JSON.stringify({ counts: result, sampleCascadeLead: sample?.[0] }, null, 2));
})();
