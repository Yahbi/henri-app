import { config } from 'dotenv';
config({ path: '.env.local' });
const secret = process.env.CRON_SECRET;

// Loop: 8 rounds of (census-geocode → enrich) interleaved with score-cron
// runs. Each round patches new contact info, geocodes new permits, then
// scores new leads with the freshly-enriched data.
const ROUNDS = 8;
const start = Date.now();
const MAX_RUNTIME = 90 * 60 * 1000; // 90min cap

async function run(slug, label) {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://meethenri.com/api/cron/${slug}`, {
      headers: { Authorization: 'Bearer ' + secret, 'x-cron-trigger': 'manual' },
      signal: AbortSignal.timeout(295_000),
    });
    let body; try { body = await res.json(); } catch { body = null; }
    const summary = body?.summary ?? body ?? {};
    const dur = Date.now() - t0;
    console.log(`[${new Date().toISOString()}] ${label}\t${res.status}\t${dur}ms\t${JSON.stringify(summary).slice(0, 220)}`);
    return { status: res.status, summary };
  } catch (e) {
    console.log(`[${new Date().toISOString()}] ${label}\tERR\t${Date.now()-t0}ms\t${e.message}`);
    return { status: 'ERR', error: e.message };
  }
}

for (let r = 1; r <= ROUNDS; r++) {
  if (Date.now() - start > MAX_RUNTIME) {
    console.log(`MAX_RUNTIME hit after round ${r-1}, stopping.`);
    break;
  }
  console.log(`\n== Round ${r}/${ROUNDS} ==`);
  await run('census-geocode',  'census-geocode');
  await run('enrich',           'enrich          ');
  await run('score',            'score (post-enrich)');
}
console.log(`\nDONE rounds=${ROUNDS} elapsed=${(Date.now()-start)/1000}s`);
