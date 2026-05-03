import { config } from 'dotenv';
config({ path: '.env.local' });
const secret = process.env.CRON_SECRET;

// Check the actual cron list from vercel.json
import { readFileSync } from 'node:fs';
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const crons = vercel.crons.map(c => c.path.replace('/api/cron/', ''));

console.log(`Probing ${crons.length} crons via HEAD/GET (auth)`);
const results = [];
for (const slug of crons) {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://meethenri.com/api/cron/${slug}`, {
      headers: { Authorization: 'Bearer ' + secret, 'x-cron-trigger': 'audit-probe' },
      signal: AbortSignal.timeout(180_000),
    });
    let body;
    try { body = await res.json(); } catch { body = null; }
    const status = res.status;
    const summary = body ? JSON.stringify(body).slice(0, 200) : 'NON_JSON';
    results.push({ slug, status, dur_ms: Date.now()-t0, summary });
    console.log(`${slug}\t${status}\t${Date.now()-t0}ms\t${summary}`);
  } catch (e) {
    results.push({ slug, status: 'ERR', dur_ms: Date.now()-t0, summary: e.message });
    console.error(`${slug}\tERR\t${e.message}`);
  }
}
console.log('\n== FAILURES ==');
for (const r of results.filter(r => r.status !== 200)) {
  console.log(`${r.slug}\t${r.status}\t${r.summary}`);
}
