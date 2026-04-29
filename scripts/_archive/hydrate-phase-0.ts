/**
 * Phase 0 hydration — the post-migration sequence.
 *
 * After `supabase/_combined_00031_00035.sql` is applied, this script:
 *   1. Re-runs the scorer so `leads.score_signals` populates
 *   2. Triggers the market-intel cron to fill `market_intel_zip`
 *   3. Reports counts + a one-line status of each Phase 0 table
 *
 * Idempotent. Safe to re-run.
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

const CRON_SECRET = process.env.CRON_SECRET!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

async function hit(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${APP_URL}${path}`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  return { status: res.status, body: (await res.text()).slice(0, 500) };
}

async function rowCount(table: string): Promise<number | string> {
  const { count, error } = await s
    .from(table)
    .select("*", { count: "estimated", head: true });
  if (error) return error.message.split("\n")[0];
  return count ?? 0;
}

(async () => {
  console.log("=== Phase 0 hydration ===\n");

  console.log("1. Running scorer (/api/cron/score)");
  const score = await hit("/api/cron/score");
  console.log(`   HTTP ${score.status}`);
  try {
    const j = JSON.parse(score.body);
    if (j.summary) {
      console.log(
        `   ✓ scored ${j.summary.scored}, leads upserted ${j.summary.leadsCreated ?? j.summary.assigned ?? "?"}, avg=${j.summary.avgScore}`,
      );
    } else {
      console.log(`   body: ${score.body.slice(0, 200)}`);
    }
  } catch {
    console.log(`   body: ${score.body.slice(0, 200)}`);
  }

  console.log("\n2. Running market-intel refresh (/api/cron/market-intel)");
  const intel = await hit("/api/cron/market-intel");
  console.log(`   HTTP ${intel.status}`);
  console.log(`   body: ${intel.body.slice(0, 200)}`);

  console.log("\n3. Table row counts");
  for (const t of [
    "leads",
    "permits",
    "lead_exclusivity_locks",
    "permit_events",
    "missed_call_events",
    "contractor_interviews",
    "market_intel_zip",
  ]) {
    const c = await rowCount(t);
    console.log(`   ${t.padEnd(32)} ${c}`);
  }

  console.log("\n4. Outreach library seed");
  const { data: lib, error: libErr } = await s
    .from("outreach_templates")
    .select("trade, channel, name")
    .eq("is_library", true);
  if (libErr) console.log(`   error: ${libErr.message}`);
  else {
    console.log(`   ${lib?.length ?? 0} library templates`);
    for (const t of lib ?? []) {
      console.log(`     - ${t.trade}/${t.channel}: ${t.name}`);
    }
  }

  console.log("\n5. Leads with score_signals populated");
  const { count: withSignals } = await s
    .from("leads")
    .select("id", { count: "estimated", head: true })
    .not("score_signals", "is", null);
  console.log(`   ${withSignals ?? 0} leads have score_signals`);

  console.log("\nDone. Dashboard now live.");
})();
