/**
 * Retry just the aborted checks from _verify-all-migrations.mjs with
 * a longer timeout + a 2s pause between calls so the Management API
 * connection pool stays warm.
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
        signal: AbortSignal.timeout(30000),
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
  { name: "00085 parcels_sidecar",  q: `SELECT to_regclass('public.parcels_sidecar') IS NOT NULL AS ok` },
  { name: "00085 parcel_sources",   q: `SELECT to_regclass('public.parcel_sources') IS NOT NULL AS ok` },
  { name: "00086 lien_sources",     q: `SELECT to_regclass('public.lien_sources') IS NOT NULL AS ok` },
  { name: "00087 leads.opportunity_stage", q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='opportunity_stage') AS ok` },
  { name: "00087 leads.reason_codes",      q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='reason_codes') AS ok` },
  { name: "00087 homeowner_intakes.opportunity_stage", q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='homeowner_intakes' AND column_name='opportunity_stage') AS ok` },
  { name: "00088 claim_territory function",  q: `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='claim_territory') AS ok` },
  { name: "00089 homeowner_intakes.consent_given_at",   q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='homeowner_intakes' AND column_name='consent_given_at') AS ok` },
  { name: "00089 homeowner_intakes.consent_text_version", q: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='homeowner_intakes' AND column_name='consent_text_version') AS ok` },
  { name: "00091 stage: pre_intent template", q: `SELECT EXISTS (SELECT 1 FROM outreach_templates WHERE is_library=true AND stage='pre_intent') AS ok` },
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
  // Pause to keep the connection warm
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`\n=== retry summary ===`);
console.log(`pass:  ${pass}`);
console.log(`fail:  ${fail}`);
console.log(`abort: ${abort}`);
