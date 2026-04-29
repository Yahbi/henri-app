/**
 * Phase 5 driver — repeatedly hits /api/cron/score until the batch reports
 * 0 processed. Uses the local dev server.
 *
 * Run:  npx tsx scripts/score-until-done.ts
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const URL = process.env.LOCAL_APP_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;
if (!SECRET) {
  console.error("CRON_SECRET missing in env");
  process.exit(1);
}

async function main() {
  let totalScored = 0;
  let totalLeads = 0;
  let iterations = 0;
  const started = Date.now();
  while (true) {
    iterations++;
    const res = await fetch(`${URL}/api/cron/score`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
      process.exit(1);
    }
    const data = (await res.json()) as {
      success?: boolean;
      summary?: { scored: number; leadsCreated: number; assigned: number };
    };
    const scored = data.summary?.scored ?? 0;
    const leads = data.summary?.leadsCreated ?? 0;
    totalScored += scored;
    totalLeads += leads;
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `iter ${iterations}: scored=${scored}  leads=${leads}  | totals ${totalScored}/${totalLeads}  (${elapsed}s)`,
    );
    if (scored === 0) break;
    if (iterations > 5000) {
      console.warn("Safety cap hit at 5000 iterations");
      break;
    }
  }
  console.log(
    `Done. ${iterations} iterations, ${totalScored} permits scored, ${totalLeads} leads created.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
