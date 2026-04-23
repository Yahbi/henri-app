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
  const { data: owner } = await s.from("profiles").select("id").eq("email", "y.abismuth@gmail.com").single();
  // Find a "new" lead
  const { data: lead } = await s
    .from("leads")
    .select("id, status, address")
    .eq("contractor_id", owner!.id)
    .eq("status", "new")
    .limit(1)
    .single();
  if (!lead) return console.log("no new lead");
  console.log("Before:", { id: lead.id, addr: lead.address, status: lead.status });
  // Update status to contacted
  const { error: upErr } = await s
    .from("leads")
    .update({ status: "contacted", contacted_at: new Date().toISOString() })
    .eq("id", lead.id);
  if (upErr) return console.log("update error:", upErr.message);
  // Verify
  const { data: after } = await s
    .from("leads")
    .select("id, status, contacted_at")
    .eq("id", lead.id)
    .single();
  console.log("After:", after);
  // Revert for next time
  await s.from("leads").update({ status: "new", contacted_at: null }).eq("id", lead.id);
  console.log("Reverted.");
})();
