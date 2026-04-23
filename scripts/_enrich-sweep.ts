/* Sweep the enrichment cron by calling /api/cron/enrich in a loop.
 * Each invocation processes 100 leads. Continues until a run returns
 * enriched=0 AND scanned=0 (i.e., nothing left to do). */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const CRON_SECRET = process.env.CRON_SECRET!;
const BASE = "http://localhost:3000";

(async () => {
  let totalEnriched = 0, totalScanned = 0, runs = 0, zeroRuns = 0;
  while (zeroRuns < 3 && runs < 500) {
    const res = await fetch(`${BASE}/api/cron/enrich`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    if (!res.ok) { console.error(`HTTP ${res.status}`); break; }
    const j = await res.json() as { summary?: { scanned: number; enriched: number; missed: number } };
    const s = j.summary;
    if (!s) break;
    runs++;
    totalEnriched += s.enriched;
    totalScanned += s.scanned;
    if (s.enriched === 0 && s.scanned < 100) zeroRuns++; else zeroRuns = 0;
    if (runs % 5 === 0 || s.enriched > 0) console.log(`  run ${runs}: scanned=${s.scanned} enriched=${s.enriched} (total enriched=${totalEnriched}/${totalScanned})`);
  }
  console.log(`\nSweep complete. Total enriched=${totalEnriched} / scanned=${totalScanned} across ${runs} runs.`);
})();
