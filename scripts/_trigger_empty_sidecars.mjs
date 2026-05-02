import { config } from 'dotenv';
config({ path: '.env.local' });
const secret = process.env.CRON_SECRET;
const targets = [
  'code-violations',
  'nifc-wildfires',
  'cdc-svi',
  'hud-zipxw',
  'hmda-rotate',
  'courtlistener-liens',
];
for (const t of targets) {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://meethenri.com/api/cron/${t}`, {
      headers: { Authorization: 'Bearer ' + secret, 'x-cron-trigger': 'manual' }
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
    console.log(`[${t}] ${res.status} ${Date.now()-t0}ms ${JSON.stringify(body).slice(0, 800)}`);
  } catch (e) {
    console.error(`[${t}] FETCH_ERR ${e.message}`);
  }
}
