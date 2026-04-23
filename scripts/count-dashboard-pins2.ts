import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  // Mirror useLeads() with geocoded_only=true
  const { data: leads, error } = await s
    .from("leads")
    .select("id, score, permits!inner(latitude, longitude, state, zip)")
    .eq("contractor_id", owner!.id)
    .not("permits.latitude", "is", null)
    .not("permits.longitude", "is", null)
    .order("score", { ascending: false })
    .limit(500);
  if (error) throw error;
  const byState = (leads ?? []).reduce((acc: any, l: any) => {
    const p = Array.isArray(l.permits) ? l.permits[0] : l.permits;
    const st = p.state || '?';
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    dashboardNowReturns: leads?.length ?? 0,
    allHaveCoords: (leads ?? []).every((l: any) => {
      const p = Array.isArray(l.permits) ? l.permits[0] : l.permits;
      return p?.latitude != null && p?.longitude != null;
    }),
    byState,
  }, null, 2));
})();
