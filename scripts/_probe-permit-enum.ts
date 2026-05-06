/**
 * Find the valid `permit_type` enum values + look at distinct source_type
 * values currently in use. Both feed the bulk importer's mapping logic.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  // Sample distinct permit_type values currently in use
  const { data: typeRows, error: tErr } = await s
    .from("permits")
    .select("permit_type")
    .limit(5000);
  if (tErr) console.error("permit_type query:", tErr);
  const types = new Set<string>();
  for (const r of typeRows ?? []) {
    const t = (r as { permit_type: string | null }).permit_type;
    if (t) types.add(t);
  }
  console.log("permit_type distinct in 5k sample:", Array.from(types).sort());

  // Same for source_type
  const { data: srcRows } = await s.from("permits").select("source_type").limit(5000);
  const srcs = new Set<string>();
  for (const r of srcRows ?? []) {
    const t = (r as { source_type: string | null }).source_type;
    if (t) srcs.add(t);
  }
  console.log("source_type distinct in 5k sample:", Array.from(srcs).sort());

  // Same for status
  const { data: statRows } = await s.from("permits").select("status").limit(5000);
  const stats = new Set<string>();
  for (const r of statRows ?? []) {
    const t = (r as { status: string | null }).status;
    if (t) stats.add(t);
  }
  console.log("status distinct in 5k sample:", Array.from(stats).sort());

  // Count rows w/ same source_id+permit_number to understand whether
  // duplicates already exist (informs the dedupe strategy).
  const { data: anchor } = await s
    .from("permits")
    .select("source_id, permit_number")
    .not("permit_number", "is", null)
    .limit(1)
    .single();
  if (anchor) {
    const { count } = await s
      .from("permits")
      .select("*", { count: "exact", head: true })
      .eq("source_id", anchor.source_id)
      .eq("permit_number", anchor.permit_number);
    console.log(`probe (${anchor.source_id?.slice(0, 30)}.../${anchor.permit_number}) count: ${count}`);
  }
}
main();
