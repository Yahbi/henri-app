/**
 * Burst-enrich runner — hit the local `/api/cron/enrich` endpoint N
 * times in a row against a live dev server. Useful for draining the
 * owner-null backlog quickly without waiting for the production cron
 * schedule (every 30 min).
 *
 * Pipeline per invocation (per cron route):
 *   - Pull BATCH_SIZE=600 leads with `year_built IS NULL`, ordered by
 *     score DESC + created_at DESC.
 *   - Work-steal through 4 concurrent workers, each enriching one lead
 *     at a time with a 500 ms inter-request pace.
 *   - County-GIS (22 jurisdictions) → Regrid fallback → OSM fallback.
 *   - 280 s hard deadline per call. Expect ~75 s typical runtime.
 *
 * Prerequisites:
 *   - Dev server running: `pnpm dev` (default port 3000)
 *   - .env.local has CRON_SECRET set
 *
 * Run:
 *   npx tsx scripts/burst-enrich.ts              # default 20 invocations
 *   COUNT=50 npx tsx scripts/burst-enrich.ts     # 50 invocations
 *   PORT=3001 COUNT=5 npx tsx scripts/burst-enrich.ts
 *
 * Output: per-invocation summary line + a final rollup showing total
 * scanned / enriched / missed across the burst.
 *
 * Safety:
 *   - Each invocation is its own HTTP request; aborting the script
 *     mid-burst is safe (the current in-flight request finishes on the
 *     server regardless).
 *   - 500 ms sleep between invocations to avoid thundering our own
 *     Postgres connection pool.
 *   - Bails on first 401 — that means CRON_SECRET is wrong, no point
 *     burning the remaining 19 invocations.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const HOST = process.env.HOST ?? "http://localhost";
const PORT = Number(process.env.PORT ?? 3000);
const COUNT = Number(process.env.COUNT ?? 20);
const CRON_SECRET = process.env.CRON_SECRET;
const INTER_CALL_MS = 500;

if (!CRON_SECRET) {
  console.error("missing CRON_SECRET in .env.local");
  process.exit(1);
}

interface CronResponse {
  success?: boolean;
  summary?: {
    scanned: number;
    processed?: number;
    enriched: number;
    missed: number;
    concurrency?: number;
    elapsedMs: number;
    hitDeadline?: boolean;
  };
  error?: string;
}

async function hit(i: number): Promise<CronResponse | null> {
  const url = `${HOST}:${PORT}/api/cron/enrich`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const body = (await res.json()) as CronResponse;
    if (res.status === 401) {
      console.error(`  [${i}/${COUNT}] 401 Unauthorized — check CRON_SECRET. bailing.`);
      process.exit(1);
    }
    const elapsedSec = Math.round((Date.now() - t0) / 1000);
    if (body.success && body.summary) {
      const s = body.summary;
      const dl = s.hitDeadline ? " [deadline hit]" : "";
      console.log(
        `  [${i}/${COUNT}] scanned=${s.scanned} enriched=${s.enriched} missed=${s.missed} elapsed=${elapsedSec}s${dl}`,
      );
    } else {
      console.warn(`  [${i}/${COUNT}] unexpected response: ${JSON.stringify(body)}`);
    }
    return body;
  } catch (e) {
    console.error(`  [${i}/${COUNT}] request failed: ${(e as Error).message}`);
    return null;
  }
}

(async () => {
  console.log(`burst-enrich — ${COUNT} invocations against ${HOST}:${PORT}`);

  const totals = { scanned: 0, enriched: 0, missed: 0, elapsedMs: 0, deadlineHits: 0 };
  const t0 = Date.now();

  for (let i = 1; i <= COUNT; i++) {
    const r = await hit(i);
    if (r?.summary) {
      totals.scanned += r.summary.scanned;
      totals.enriched += r.summary.enriched;
      totals.missed += r.summary.missed;
      totals.elapsedMs += r.summary.elapsedMs;
      if (r.summary.hitDeadline) totals.deadlineHits++;
    }
    if (i < COUNT) await new Promise((r) => setTimeout(r, INTER_CALL_MS));
  }

  const wallSec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n──────── summary ────────`);
  console.log(`invocations : ${COUNT}`);
  console.log(`scanned     : ${totals.scanned.toLocaleString()}`);
  console.log(`enriched    : ${totals.enriched.toLocaleString()}`);
  console.log(`missed      : ${totals.missed.toLocaleString()}`);
  console.log(`hit ratio   : ${totals.scanned > 0 ? ((totals.enriched / totals.scanned) * 100).toFixed(1) : 0}%`);
  console.log(`deadline hits: ${totals.deadlineHits}/${COUNT}`);
  console.log(`wall time   : ${wallSec}s`);
  console.log(`server time : ${Math.round(totals.elapsedMs / 1000)}s`);
})();
