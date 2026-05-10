/**
 * Migration 00087 added `leads.opportunity_stage`,
 * `leads.reason_codes`, `leads.trade_tags` columns successfully but
 * the partial + GIN indexes silently rolled back inside the
 * BEGIN/COMMIT block (same bug pattern that broke 00093 matview
 * creation). Creating them now via CONCURRENTLY so they don't lock
 * the table + don't have to fit inside the 8s statement timeout.
 *
 * Without these indexes, every `WHERE opportunity_stage IS NOT NULL`
 * query (LeadsPanel filter, kanban stage filter, stage_history
 * backfill cursor probe) does a sequential scan over 270k rows
 * and times out.
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
      signal: AbortSignal.timeout(180000),
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

const statements = [
  {
    name: "leads_opportunity_stage_idx (partial)",
    q: `CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_opportunity_stage_idx
        ON public.leads (opportunity_stage)
        WHERE opportunity_stage IS NOT NULL`,
  },
  {
    name: "leads_reason_codes_gin",
    q: `CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_reason_codes_gin
        ON public.leads USING GIN (reason_codes)`,
  },
  {
    name: "leads_trade_tags_gin",
    q: `CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_trade_tags_gin
        ON public.leads USING GIN (trade_tags)`,
  },
  {
    name: "homeowner_intakes_opportunity_stage_idx (partial)",
    q: `CREATE INDEX CONCURRENTLY IF NOT EXISTS homeowner_intakes_opportunity_stage_idx
        ON public.homeowner_intakes (opportunity_stage)
        WHERE opportunity_stage IS NOT NULL`,
  },
];

for (const s of statements) {
  console.log(`\n=== ${s.name} ===`);
  const t0 = Date.now();
  const result = await sql(s.q);
  const ms = Date.now() - t0;
  if (result?.message && /ERROR/.test(result.message)) {
    console.error(`FAIL in ${ms}ms: ${result.message.slice(0, 200)}`);
    continue;
  }
  console.log(`ok in ${ms}ms`);
}

console.log("\n=== verify all indexes exist ===");
const r = await sql(
  `SELECT indexname FROM pg_indexes WHERE indexname IN (
     'leads_opportunity_stage_idx',
     'leads_reason_codes_gin',
     'leads_trade_tags_gin',
     'homeowner_intakes_opportunity_stage_idx'
   )`,
);
console.log(JSON.stringify(r, null, 2));
