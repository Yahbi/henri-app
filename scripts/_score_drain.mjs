import { config } from 'dotenv';
config({ path: '.env.local' });
const secret = process.env.CRON_SECRET;
const TARGET_REMAINING = 50_000; // stop when backlog under 50k
const fs = await import('node:fs/promises');
const start = Date.now();
let totalScored = 0, totalAssigned = 0, totalRuns = 0, emptyRuns = 0;

// Cap total run-time at ~2 hours so the process exits cleanly even
// if something stalls. Each iteration takes ~10-20s, so 2hrs ≈ 720 runs.
const MAX_RUNTIME_MS = 2 * 60 * 60 * 1000;
const MAX_RUNS = 1000;

for (let i = 0; i < MAX_RUNS; i++) {
  if (Date.now() - start > MAX_RUNTIME_MS) {
    console.log(`MAX_RUNTIME reached after ${i} runs.`);
    break;
  }
  const t0 = Date.now();
  try {
    const res = await fetch('https://meethenri.com/api/cron/score', {
      headers: { Authorization: 'Bearer ' + secret, 'x-cron-trigger': 'manual' }
    });
    const j = await res.json();
    const s = j.summary ?? {};
    totalScored += s.scored ?? 0;
    totalAssigned += s.leadsCreated ?? 0;
    totalRuns++;
    const line = `[${new Date().toISOString()}] run=${i+1} scored=${s.scored ?? 'NA'} assigned=${s.leadsCreated ?? 'NA'} marked=${s.permits_marked_scored ?? 'NA'} dur=${Date.now()-t0}ms cum_scored=${totalScored} cum_assigned=${totalAssigned}`;
    console.log(line);
    await fs.appendFile('scripts/_score_drain.log', line + '\n');
    if ((s.scored ?? 0) === 0) {
      emptyRuns++;
      if (emptyRuns >= 3) { console.log('3 empty runs in a row -- backlog drained.'); break; }
    } else {
      emptyRuns = 0;
    }
  } catch (e) {
    console.error(`run=${i+1} ERR ${e.message}`);
    await new Promise(r => setTimeout(r, 5000));
  }
}
console.log(`DONE runs=${totalRuns} totalScored=${totalScored} totalAssigned=${totalAssigned} elapsed=${(Date.now()-start)/1000}s`);
