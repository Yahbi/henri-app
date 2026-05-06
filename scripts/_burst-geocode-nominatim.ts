/**
 * Burst the Nominatim-based geocode-backfill cron route. Each run drains
 * 250 permits at 1 req/sec → ~5 minutes per run.
 *
 * Pairs with /api/cron/geocode-backfill/route.ts which uses OpenStreetMap
 * Nominatim (free, 1 req/sec policy). The Census Bureau script
 * (`backfill-geocode.ts`) is currently returning 502s — this is the working
 * fallback.
 *
 * Usage:
 *   npx tsx scripts/_burst-geocode-nominatim.ts
 *   COUNT=50 npx tsx scripts/_burst-geocode-nominatim.ts
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const HOST = process.env.HOST ?? "http://localhost";
const PORT = Number(process.env.PORT ?? 3000);
const COUNT = Number(process.env.COUNT ?? 30);
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error("missing CRON_SECRET");
  process.exit(1);
}

interface CronResp {
  success?: boolean;
  geocoded?: number;
  failed?: number;
  scanned?: number;
  elapsedMs?: number;
  error?: string;
}

async function hit(i: number): Promise<CronResp | null> {
  const url = `${HOST}:${PORT}/api/cron/geocode-backfill`;
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const body = (await res.json()) as CronResp;
  if (res.status === 401) {
    console.error(`  [${i}/${COUNT}] 401 — bailing.`);
    process.exit(1);
  }
  const sec = Math.round((Date.now() - t0) / 1000);
  if (body.success) {
    console.log(
      `  [${i}/${COUNT}] geocoded=${body.geocoded ?? 0} failed=${body.failed ?? 0} scanned=${body.scanned ?? 0} elapsed=${sec}s`,
    );
  } else {
    console.log(`  [${i}/${COUNT}] error: ${body.error ?? "unknown"} elapsed=${sec}s`);
  }
  return body;
}

(async () => {
  console.log(`burst-geocode-nominatim — ${COUNT} runs against ${HOST}:${PORT}`);
  let totalGeocoded = 0;
  let totalScanned = 0;
  let zeroRuns = 0;
  for (let i = 1; i <= COUNT; i++) {
    const r = await hit(i);
    if (!r) break;
    totalGeocoded += r.geocoded ?? 0;
    totalScanned += r.scanned ?? 0;
    if ((r.geocoded ?? 0) === 0 && (r.scanned ?? 0) < 50) {
      zeroRuns++;
      if (zeroRuns >= 3) {
        console.log(`  3 consecutive empty runs — backlog drained or all failing. stopping.`);
        break;
      }
    } else {
      zeroRuns = 0;
    }
  }
  console.log(
    `\nTotal: scanned=${totalScanned}, geocoded=${totalGeocoded} (${(((totalGeocoded || 0) / Math.max(1, totalScanned)) * 100).toFixed(1)}%)`,
  );
})();
