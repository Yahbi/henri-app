/**
 * Probe the unique constraint on `permits` so the bulk importer can
 * upsert with the right onConflict target. Tries the most likely
 * candidates: (source_id, permit_number), (permit_number), (id only).
 *
 * Read-only — does an INSERT of a single throwaway row, deletes it.
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
  const probe = {
    permit_number: "_probe_" + Math.random().toString(36).slice(2),
    source_id: "_probe_url",
    source_type: "probe",
    source_city: "Probe",
    state: "XX",
    city: "Probeville",
    permit_type: "probe",
    status: "probe",
    address: "1 Probe St",
  };

  // Insert it twice — second insert exposes the conflict (if any).
  const ins1 = await s.from("permits").insert([probe]).select("id").single();
  console.log("first insert:", ins1.error?.message ?? "ok id=" + ins1.data?.id);

  const ins2 = await s.from("permits").insert([probe]).select("id").single();
  console.log("second insert:", ins2.error?.message ?? "ok id=" + ins2.data?.id);

  // Try upsert with various onConflict targets
  for (const onConflict of ["source_id,permit_number", "permit_number", "source_id"]) {
    const up = await s.from("permits").upsert([probe], { onConflict, ignoreDuplicates: true });
    console.log(`upsert onConflict=${onConflict}:`, up.error?.message ?? "ok");
  }

  // Cleanup
  if (ins1.data?.id) await s.from("permits").delete().eq("id", ins1.data.id);
  if (ins2.data?.id) await s.from("permits").delete().eq("id", ins2.data.id);
  // Catch any others in case both inserts succeeded
  await s.from("permits").delete().eq("permit_number", probe.permit_number);
}
main();
