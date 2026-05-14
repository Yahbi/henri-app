/**
 * Run migration 00096's INSERT in isolation (the apply-migrations
 * script got killed mid-statement when DB was saturated). Idempotent
 * via WHERE NOT EXISTS — safe to re-run.
 *
 * The backfill row count maps 1-to-1 with leads having a non-null
 * opportunity_stage. ~95k rows expected today (Sprint Z task 1
 * stamped that many before crashing on offset ceiling).
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
      signal: AbortSignal.timeout(60000),
    },
  );
  const text = await r.text();
  if (text.startsWith("<")) {
    if (attempt < 3) {
      const wait = 5000 * Math.pow(1.6, attempt);
      console.log(`[retry] HTML, attempt ${attempt + 1}/3, wait ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(q, attempt + 1);
    }
    throw new Error(`HTML after 3 retries`);
  }
  return JSON.parse(text);
};

console.log("=== pre-state: stage_history row count ===");
try {
  const before = await sql(`SELECT COUNT(*)::int AS n FROM public.stage_history`);
  console.log("history rows before:", JSON.stringify(before));
} catch (e) {
  console.log("(probe failed:", e.message + ")");
}

console.log("\n=== run backfill (idempotent) ===");
const t0 = Date.now();
try {
  const result = await sql(`
    INSERT INTO public.stage_history (lead_id, from_stage, to_stage, changed_at, changed_by_kind)
    SELECT
      l.id,
      NULL,
      l.opportunity_stage,
      COALESCE(l.updated_at, l.created_at, NOW()),
      'backfill'
    FROM public.leads l
    WHERE l.opportunity_stage IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.stage_history sh WHERE sh.lead_id = l.id
      )
  `);
  const elapsed = Date.now() - t0;
  if (result?.message && /ERROR/.test(result.message)) {
    console.error(`FAIL in ${elapsed}ms: ${result.message.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`ok in ${elapsed}ms`);
} catch (e) {
  console.error("backfill failed:", e.message);
  process.exit(1);
}

console.log("\n=== post-state: stage_history row count ===");
try {
  const after = await sql(`SELECT COUNT(*)::int AS n FROM public.stage_history`);
  console.log("history rows after:", JSON.stringify(after));
} catch (e) {
  console.log("(probe failed:", e.message + ")");
}

console.log("\n=== sample 3 rows ===");
try {
  const sample = await sql(
    `SELECT lead_id, to_stage, changed_at, changed_by_kind FROM public.stage_history WHERE changed_by_kind = 'backfill' LIMIT 3`,
  );
  console.log(JSON.stringify(sample, null, 2));
} catch (e) {
  console.log("(sample probe failed)");
}
