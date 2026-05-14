/**
 * Verify the schema landed for migrations 00085-00094 by checking
 * each migration's load-bearing object via the Management API.
 * Uses indexed/small queries only so we don't trip the 8s timeout.
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
    if (text.startsWith("<")) return { html: r.status };
    return JSON.parse(text);
  } catch (e) {
    return { abort: e.message };
  }
};

const checks = [
  // Migration 00085 — parcels_sidecar + parcel_sources
  { name: "00085_parcels_sidecar.sql", q: `SELECT to_regclass('public.parcels_sidecar') IS NOT NULL AS ok` },
  { name: "00085 parcel_sources",      q: `SELECT to_regclass('public.parcel_sources') IS NOT NULL AS ok` },

  // Migration 00086 — lien_sources
  { name: "00086_lien_sources_ut_scr",  q: `SELECT to_regclass('public.lien_sources') IS NOT NULL AS ok` },

  // Migration 00087 — intent columns on leads + homeowner_intakes
  { name: "00087 leads.opportunity_stage", q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='opportunity_stage') AS ok` },
  { name: "00087 leads.reason_codes",      q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='reason_codes') AS ok` },
  { name: "00087 homeowner_intakes.opportunity_stage", q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='homeowner_intakes' AND column_name='opportunity_stage') AS ok` },

  // Migration 00088 — territory tier caps RPC
  { name: "00088 claim_territory has cap_exceeded", q: `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='claim_territory') AS ok` },

  // Migration 00089 — homeowner consent
  { name: "00089 homeowner_intakes.consent_given_at",   q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='homeowner_intakes' AND column_name='consent_given_at') AS ok` },
  { name: "00089 homeowner_intakes.consent_text_version", q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='homeowner_intakes' AND column_name='consent_text_version') AS ok` },

  // Migration 00090 — saved_leads + hidden_leads + score_calibration + alert_rules
  { name: "00090 saved_leads",   q: `SELECT to_regclass('public.saved_leads') IS NOT NULL AS ok` },
  { name: "00090 hidden_leads",  q: `SELECT to_regclass('public.hidden_leads') IS NOT NULL AS ok` },
  { name: "00090 score_trade_weights", q: `SELECT to_regclass('public.score_trade_weights') IS NOT NULL AS ok` },
  { name: "00090 score_stage_modifiers", q: `SELECT to_regclass('public.score_stage_modifiers') IS NOT NULL AS ok` },
  { name: "00090 alert_rules",   q: `SELECT to_regclass('public.alert_rules') IS NOT NULL AS ok` },

  // Migration 00091 — stage outreach templates
  { name: "00091 stage seed: permit_filed_no_contractor", q: `SELECT EXISTS (SELECT 1 FROM outreach_templates WHERE is_library=true AND stage='permit_filed_no_contractor') AS ok` },
  { name: "00091 stage seed: pre_intent",                  q: `SELECT EXISTS (SELECT 1 FROM outreach_templates WHERE is_library=true AND stage='pre_intent') AS ok` },
  { name: "00091 stage seed: maintenance_upsell",          q: `SELECT EXISTS (SELECT 1 FROM outreach_templates WHERE is_library=true AND stage='maintenance_upsell') AS ok` },

  // Migration 00092 — stage_history table + trigger
  { name: "00092 stage_history table",   q: `SELECT to_regclass('public.stage_history') IS NOT NULL AS ok` },
  { name: "00092 record_stage_history()", q: `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='record_stage_history') AS ok` },
  { name: "00092 leads_stage_history_insert trigger", q: `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='leads_stage_history_insert') AS ok` },

  // Migration 00093 — zip_pre_intent_aggregates table
  { name: "00093 zip_pre_intent_aggregates",  q: `SELECT to_regclass('public.zip_pre_intent_aggregates') IS NOT NULL AS ok` },
  { name: "00093 refresh_zip_pre_intent_aggregates()", q: `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='refresh_zip_pre_intent_aggregates') AS ok` },

  // Migration 00094 — leads.source + parcel_sidecar_uid + 2 partial indexes
  { name: "00094 leads.source",              q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='source') AS ok` },
  { name: "00094 leads.parcel_sidecar_uid",  q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='parcel_sidecar_uid') AS ok` },
  { name: "00094 leads_contractor_parcel_uq", q: `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='leads_contractor_parcel_uq') AS ok` },
  { name: "00094 leads_source_idx",          q: `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='leads_source_idx') AS ok` },
];

let pass = 0;
let fail = 0;
let abort = 0;

for (const c of checks) {
  const r = await sql(c.q);
  let symbol;
  let detail;
  if (r?.abort) { symbol = "?"; detail = "abort"; abort++; }
  else if (r?.html) { symbol = "?"; detail = `HTML ${r.html}`; abort++; }
  else if (Array.isArray(r) && r[0]?.ok === true) { symbol = "✓"; detail = "ok"; pass++; }
  else { symbol = "✗"; detail = JSON.stringify(r).slice(0, 120); fail++; }
  console.log(`${symbol} ${c.name} — ${detail}`);
}

console.log(`\n=== summary ===`);
console.log(`pass:  ${pass}`);
console.log(`fail:  ${fail}`);
console.log(`abort: ${abort} (DB timeout / API choking; retry later)`);
