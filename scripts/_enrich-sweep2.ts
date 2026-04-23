/* Resilient enrich sweep — single concurrent request to respect county
 * GIS rate limits, swallow 500s, stop after N consecutive empties. */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const CRON_SECRET = process.env.CRON_SECRET!;
const BASE = "http://localhost:3000";
const STOP_AFTER_EMPTIES = 5;
const MAX_RUNS = 200;

(async () => {
  let totalEnriched = 0, totalScanned = 0, runs = 0, empties = 0;
  while (empties < STOP_AFTER_EMPTIES && runs < MAX_RUNS) {
    try {
      const res = await fetch(`${BASE}/api/cron/enrich`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
      runs++;
      if (!res.ok) { console.warn(`  run ${runs}: HTTP ${res.status}; backing off 10s`); await new Promise(r => setTimeout(r, 10000)); empties++; continue; }
      const j = await res.json() as { summary?: { scanned: number; enriched: number } };
      const s = j.summary;
      if (!s) { empties++; continue; }
      totalEnriched += s.enriched;
      totalScanned += s.scanned;
      if (s.enriched === 0) empties++; else empties = 0;
      if (s.enriched > 0 || runs % 5 === 0) console.log(`  run ${runs}: scanned=${s.scanned} enriched=${s.enriched} (total enriched=${totalEnriched}/${totalScanned} empties=${empties})`);
    } catch (e) {
      console.warn(`  run ${runs}: threw ${(e as Error).message}; backing off`);
      await new Promise(r => setTimeout(r, 10000));
      empties++;
    }
  }
  console.log(`\nSweep complete. enriched=${totalEnriched}/${totalScanned} across ${runs} runs.`);
})();
