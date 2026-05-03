import { config } from 'dotenv';
config({ path: '.env.local' });
const secret = process.env.CRON_SECRET;
const targets = [
  ['census-geocode', 'fills lat/lng on the 60% of leads without coords'],
  ['geocode-backfill', 'older permits geocode'],
  ['enrich', 'phone/email/owner_name backfill (fires Numverify, Cloudmersive)'],
  ['re-enrich', 'refreshes enrichment on stale leads'],
];
for (const [slug, why] of targets) {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://meethenri.com/api/cron/${slug}`, {
      headers: { Authorization: 'Bearer ' + secret, 'x-cron-trigger': 'manual' },
      signal: AbortSignal.timeout(295_000),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 600); }
    console.log(`[${slug}] ${res.status} ${Date.now()-t0}ms — ${why}`);
    console.log(`  ${JSON.stringify(body).slice(0, 1500)}`);
  } catch (e) {
    console.log(`[${slug}] ERR ${Date.now()-t0}ms ${e.message}`);
  }
}
