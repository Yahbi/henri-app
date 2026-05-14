/**
 * Chunked stage_history backfill — splits the WHERE NOT EXISTS
 * INSERT across N chunks bounded by lead.id ranges so each chunk
 * fits inside the Mgmt API's 60s timeout window. Idempotent.
 *
 * Strategy: walk leads in lexicographic id order using keyset
 * pagination (matches the working _backfill-intent.mjs pattern).
 * Each chunk INSERTs history rows for the next ~10k leads, then
 * advances the cursor.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const sql = async (q, attempt = 0) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/ivfxylgoxgrxttknewsf/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: q }),
      signal: AbortSignal.timeout(70000),
    },
  );
  const text = await r.text();
  if (text.startsWith("<")) {
    if (attempt < 3) {
      const wait = 5000 * Math.pow(1.6, attempt);
      console.log(`  [retry] HTML, attempt ${attempt + 1}/3, wait ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(q, attempt + 1);
    }
    throw new Error(`HTML after 3 retries`);
  }
  return JSON.parse(text);
};

const CHUNK = 10_000;
const ARG_AFTER_ID =
  process.argv.find((a) => a.startsWith("--start-after-id="))?.split("=")[1] ||
  null;

let lastId = ARG_AFTER_ID;
let totalInserted = 0;
let chunkN = 0;

console.log(`=== chunked stage_history backfill (${CHUNK}/chunk) ===`);
if (lastId) console.log(`resuming from id > ${lastId}`);

while (true) {
  chunkN += 1;
  const t0 = Date.now();

  // Compute next chunk's upper bound — the id of the row CHUNK rows
  // after the cursor. We use a separate SELECT to find this so the
  // INSERT can range-filter rather than LIMIT.
  const cursorRes = await sql(
    `SELECT id FROM public.leads
       WHERE opportunity_stage IS NOT NULL
         ${lastId ? `AND id > '${lastId}'::uuid` : ""}
       ORDER BY id ASC
       LIMIT 1 OFFSET ${CHUNK - 1}`,
  );
  const upperId = Array.isArray(cursorRes) ? cursorRes[0]?.id ?? null : null;

  // No more rows.
  if (!upperId && lastId) {
    // We may still have a tail < CHUNK rows. Run one final unbounded
    // chunk to drain it.
    console.log(`\n[chunk ${chunkN}] tail (no upper bound)`);
    const tailRes = await sql(`
      WITH inserted AS (
        INSERT INTO public.stage_history (lead_id, from_stage, to_stage, changed_at, changed_by_kind)
        SELECT
          l.id, NULL, l.opportunity_stage,
          COALESCE(l.updated_at, l.created_at, NOW()),
          'backfill'
        FROM public.leads l
        WHERE l.opportunity_stage IS NOT NULL
          AND l.id > '${lastId}'::uuid
          AND NOT EXISTS (SELECT 1 FROM public.stage_history sh WHERE sh.lead_id = l.id)
        RETURNING 1
      )
      SELECT COUNT(*)::int AS n FROM inserted
    `);
    const tailN = Array.isArray(tailRes) ? tailRes[0]?.n ?? 0 : 0;
    totalInserted += tailN;
    console.log(`  inserted: ${tailN} in ${Date.now() - t0}ms`);
    break;
  }
  if (!upperId) {
    console.log(`\n[chunk ${chunkN}] no rows in scope — empty`);
    break;
  }

  // Insert the bounded chunk.
  const lowerCond = lastId ? `AND l.id > '${lastId}'::uuid` : "";
  const r = await sql(`
    WITH inserted AS (
      INSERT INTO public.stage_history (lead_id, from_stage, to_stage, changed_at, changed_by_kind)
      SELECT
        l.id, NULL, l.opportunity_stage,
        COALESCE(l.updated_at, l.created_at, NOW()),
        'backfill'
      FROM public.leads l
      WHERE l.opportunity_stage IS NOT NULL
        ${lowerCond}
        AND l.id <= '${upperId}'::uuid
        AND NOT EXISTS (SELECT 1 FROM public.stage_history sh WHERE sh.lead_id = l.id)
      RETURNING 1
    )
    SELECT COUNT(*)::int AS n FROM inserted
  `);
  const n = Array.isArray(r) ? r[0]?.n ?? 0 : 0;
  totalInserted += n;
  const elapsed = Date.now() - t0;
  console.log(`[chunk ${chunkN}] cursor=${upperId} inserted=${n} elapsed=${elapsed}ms total=${totalInserted}`);
  lastId = upperId;

  // Defensive: small pause between chunks so we don't hammer.
  await new Promise((r) => setTimeout(r, 500));
}

console.log(`\n=== final ===`);
console.log(`chunks: ${chunkN}, inserted: ${totalInserted}`);

const after = await sql(`SELECT COUNT(*)::int AS n FROM public.stage_history`);
console.log(`stage_history total rows now: ${JSON.stringify(after)}`);
