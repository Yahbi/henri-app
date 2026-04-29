/**
 * Sample-based coverage check for `leads.score_signals` backfill.
 * Pulls 1000 random leads (newest) and reports % populated.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  const { data, error } = await s
    .from("leads")
    .select("id, score_signals")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    console.error(error.message);
    return;
  }
  const withSig = data?.filter((l) => l.score_signals).length ?? 0;
  const total = data?.length ?? 0;
  console.log(
    `Sample of ${total} newest leads: ${withSig} have score_signals (${Math.round(
      (withSig / total) * 100,
    )}%)`,
  );
})();
