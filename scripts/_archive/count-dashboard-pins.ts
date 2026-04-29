import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  // Mirror useLeads() query with limit=500
  const { data: leads, error } = await s
    .from("leads")
    .select("id, score, urgency, permits!inner(latitude, longitude, address, state, zip)")
    .eq("contractor_id", owner!.id)
    .order("score", { ascending: false })
    .limit(500);
  if (error) throw error;
  const withCoords = (leads ?? []).filter((l: any) => {
    const p = Array.isArray(l.permits) ? l.permits[0] : l.permits;
    return p?.latitude != null && p?.longitude != null;
  });
  // Group withCoords by state to understand spread
  const byState = withCoords.reduce((acc: any, l: any) => {
    const p = Array.isArray(l.permits) ? l.permits[0] : l.permits;
    const st = p.state || 'unknown';
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    dashboard_uses_useLeads_limit: 500,
    totalReturned: leads?.length ?? 0,
    withCoords: withCoords.length,
    byState,
  }, null, 2));
})();
