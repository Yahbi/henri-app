import { config } from 'dotenv';
config({ path: '.env.local' });
const secret = process.env.CRON_SECRET;
const start = Date.now();
let totalScored = 0, totalAssigned = 0, runs = 0, errors = 0;
const MAX_RUNS = 60;
for (let i = 0; i < MAX_RUNS; i++) {
  const t0 = Date.now();
  try {
    const res = await fetch('https://meethenri.com/api/cron/score', {
      headers: { Authorization: 'Bearer ' + secret, 'x-cron-trigger': 'manual' }
    });
    const j = await res.json();
    const s = j.summary ?? {};
    totalScored += s.scored ?? 0;
    totalAssigned += s.leadsCreated ?? 0;
    runs++;
    console.log(`[${i+1}/${MAX_RUNS}] scored=${s.scored} assigned=${s.leadsCreated} marked=${s.permits_marked_scored} errors=${s.permits_mark_errors} dur=${Date.now()-t0}ms total_scored=${totalScored}`);
    if ((s.scored ?? 0) === 0) { console.log('Drained or deadline. Stop.'); break; }
  } catch (e) {
    errors++; console.error(`[${i+1}/${MAX_RUNS}] ERR ${e.message}`);
    if (errors > 3) break;
  }
}
console.log(`DONE runs=${runs} totalScored=${totalScored} totalAssigned=${totalAssigned} elapsed=${(Date.now()-start)/1000}s`);
