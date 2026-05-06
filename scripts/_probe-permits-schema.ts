/**
 * One-off: dump the column list of the live `permits` table so we know
 * exactly which columns the bulk importer can write to. Without this we'd
 * blindly write contact_confidence (migration 00039 not applied) and the
 * whole insert would fail like /api/cron/permits did this morning.
 *
 * Read-only. Safe to delete after the importer is settled.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const s = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // Pull one row + ask for the count. PostgREST returns the column set
  // even on an empty result via the `Range-Unit` header workaround; the
  // simplest cross-version probe is just to read one row.
  const { data, error } = await s.from("permits").select("*").limit(1);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  if (!data?.[0]) {
    console.log("(table empty)");
    return;
  }
  const cols = Object.keys(data[0] as Record<string, unknown>).sort();
  console.log("Columns on `permits` (n=" + cols.length + "):");
  for (const c of cols) {
    const v = (data[0] as Record<string, unknown>)[c];
    const t = v === null ? "null" : typeof v;
    console.log(`  ${c.padEnd(28)} ${t}`);
  }
}
main();
