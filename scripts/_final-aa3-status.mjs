/**
 * Final Phase AA-3 status check — only fast, indexed queries.
 * Avoids any aggregate that would trip the saturated DB.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const sql = async (q) => {
  try {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/ivfxylgoxgrxttknewsf/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: q }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const text = await r.text();
    if (text.startsWith("<")) return { __html: r.status };
    try { return JSON.parse(text); } catch { return { __raw: text.slice(0, 100) }; }
  } catch (e) {
    return { __abort: e.message };
  }
}

console.log("=== leads.source column ===");
console.log(JSON.stringify(await sql(`SELECT column_name, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name IN ('source','parcel_sidecar_uid')`)));

console.log("\n=== leads.source — sample row read (indexed) ===");
console.log(JSON.stringify(await sql(`SELECT id, source FROM leads WHERE source = 'permit' LIMIT 1`)));

console.log("\n=== leads.source — synthesised row read (uses partial index) ===");
console.log(JSON.stringify(await sql(`SELECT id, source FROM leads WHERE source = 'parcel_synthesis' LIMIT 1`)));

console.log("\n=== leads indexes ===");
console.log(JSON.stringify(await sql(`SELECT indexname FROM pg_indexes WHERE tablename='leads' AND indexname IN ('leads_contractor_parcel_uq','leads_source_idx')`)));

console.log("\n=== zip_pre_intent_aggregates table state ===");
console.log(JSON.stringify(await sql(`SELECT COUNT(*)::int AS row_count FROM zip_pre_intent_aggregates`)));

console.log("\n=== alert_rules + saved_leads + hidden_leads (Phase AA-2) ===");
console.log(JSON.stringify(await sql(`SELECT relname, reltuples::bigint AS estimated_rows FROM pg_class WHERE relname IN ('alert_rules','saved_leads','hidden_leads','zip_pre_intent_aggregates','stage_history') ORDER BY relname`)));

console.log("\n=== migration tracking (last applied) ===");
console.log(JSON.stringify(await sql(`SELECT count(*)::int FROM information_schema.tables WHERE table_name IN ('alert_rules','saved_leads','hidden_leads','zip_pre_intent_aggregates','stage_history','score_trade_weights','score_stage_modifiers','outreach_templates') AND table_schema='public'`)));
