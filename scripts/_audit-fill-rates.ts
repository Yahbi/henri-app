/**
 * Per-field fill rate audit — SUPERSEDES the curl/bash audit which had
 * column-name escaping bugs. Uses the Supabase JS client directly so the
 * results are authoritative.
 *
 * Read-only.
 *
 * Usage: npx tsx scripts/_audit-fill-rates.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const GROUPS: { name: string; fields: string[] }[] = [
  { name: "Geocoding", fields: ["latitude", "longitude", "address", "city", "state", "zip", "permit_type", "permit_value", "permit_description"] },
  { name: "Ownership", fields: ["owner_name", "owner_first", "owner_last", "phone", "phone2", "email", "email2", "mailing_address", "owner_occupied", "owner_since", "co_owner"] },
  { name: "Property", fields: ["year_built", "home_sqft", "lot_sqft", "assessed_value", "property_value"] },
  { name: "Provenance (00039)", fields: ["contact_source", "contact_confidence", "contact_extracted_at"] },
  { name: "Extended enrichment (00044)", fields: ["employer", "occupation", "business_phone", "business_status", "business_website", "license_number", "license_status", "naics_code"] },
  { name: "Predictive (00045)", fields: ["cross_trade_suggestions"] },
  { name: "Lifecycle", fields: ["last_enriched_at", "contacted_at", "won_at", "score_signals", "notes", "permit_history", "pipeline_value"] },
];

async function notNullCount(field: string): Promise<number> {
  // Try estimated count first (fast on big tables); fall back to exact if
  // estimated returns null/error for this column.
  const { count, error } = await s
    .from("leads")
    .select("*", { count: "estimated", head: true })
    .not(field, "is", null);
  if (!error && typeof count === "number") return count;
  // Exact-count fallback for columns where estimated misbehaves (some
  // PostgREST versions choke on jsonb / text-array columns under estimated).
  const { count: c2, error: e2 } = await s
    .from("leads")
    .select("*", { count: "exact", head: true })
    .not(field, "is", null);
  if (e2) throw new Error(`${field}: ${e2.message || JSON.stringify(e2)}`);
  return c2 ?? 0;
}

async function exactCount(field: string, value: unknown): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = s.from("leads").select("*", { count: "estimated", head: true });
  const { count, error } = await q.eq(field, value);
  if (error) throw error;
  return count ?? 0;
}

async function totalLeads(): Promise<number> {
  const { count } = await s
    .from("leads")
    .select("*", { count: "estimated", head: true });
  return count ?? 0;
}

function pct(n: number, d: number): string {
  if (d <= 0) return "n/a";
  return ((n / d) * 100).toFixed(1) + "%";
}

async function main() {
  console.log("══ Henri leads fill-rate audit ════════════════════════════════════");
  const total = await totalLeads();
  console.log(`Total leads (estimated): ${total.toLocaleString()}\n`);

  for (const g of GROUPS) {
    console.log(`── ${g.name} ${"─".repeat(Math.max(0, 60 - g.name.length))}`);
    console.log("  Field".padEnd(34) + "Populated".padStart(12) + "  Pct");
    for (const f of g.fields) {
      try {
        const c = await notNullCount(f);
        const p = pct(c, total);
        const flag = c / total < 0.1 ? "  🔴" : c / total < 0.5 ? "  🟡" : "  ✅";
        console.log(`  ${f.padEnd(32)}${c.toLocaleString().padStart(12)}${p.padStart(7)}${flag}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  ${f.padEnd(32)}${"ERR".padStart(12)}    ${msg.slice(0, 40)}`);
      }
    }
    console.log();
  }

  // Cross-cuts that matter for outreach + UX.
  console.log(`── Cross-field combos (deliverability) ──`);
  const { count: fullContact } = await s
    .from("leads")
    .select("*", { count: "estimated", head: true })
    .not("owner_name", "is", null)
    .not("phone", "is", null);
  console.log(`  owner_name + phone               : ${(fullContact ?? 0).toLocaleString()} (${pct(fullContact ?? 0, total)})`);

  const { count: ownerEmail } = await s
    .from("leads")
    .select("*", { count: "estimated", head: true })
    .not("owner_name", "is", null)
    .not("email", "is", null);
  console.log(`  owner_name + email               : ${(ownerEmail ?? 0).toLocaleString()} (${pct(ownerEmail ?? 0, total)})`);

  const { count: fullProperty } = await s
    .from("leads")
    .select("*", { count: "estimated", head: true })
    .not("year_built", "is", null)
    .not("assessed_value", "is", null);
  console.log(`  year_built + assessed_value      : ${(fullProperty ?? 0).toLocaleString()} (${pct(fullProperty ?? 0, total)})`);

  const { count: geocoded } = await s
    .from("leads")
    .select("*", { count: "estimated", head: true })
    .not("latitude", "is", null)
    .not("longitude", "is", null);
  console.log(`  latitude + longitude (geocoded)  : ${(geocoded ?? 0).toLocaleString()} (${pct(geocoded ?? 0, total)})`);

  const { count: dispatchReady } = await s
    .from("leads")
    .select("*", { count: "estimated", head: true })
    .not("owner_name", "is", null)
    .not("phone", "is", null)
    .not("year_built", "is", null);
  console.log(`  owner + phone + year_built       : ${(dispatchReady ?? 0).toLocaleString()} (${pct(dispatchReady ?? 0, total)})`);

  console.log("\n══ Audit done ══");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
