#!/usr/bin/env node
/**
 * Bulk-apply field-mapping CSV to permit_sources.
 *
 * Reads the CSV produced by _audit-field-mappings.ts and issues one
 * UPDATE per row WHERE recommendation = 'UPDATE'. Other recommendations
 * are reported but NOT auto-applied:
 *   - DEAD_404 / DEAD_5XX / EMPTY / STALE_>90d → flagged for manual
 *     review (`enabled = false` would be too aggressive without a
 *     human eyeballing first).
 *   - AUTH_REQUIRED → flagged for Phase 4 backlog.
 *   - KEEP_AS_IS → noop.
 *
 * Use --apply-disables to actually flip enabled=false on dead rows.
 *
 * Usage:
 *   node scripts/_apply-field-mappings.mjs <csv-path>
 *   node scripts/_apply-field-mappings.mjs <csv> --apply-disables
 *   node scripts/_apply-field-mappings.mjs <csv> --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const s = createClient(SUPABASE_URL, SUPABASE_SR, { auth: { persistSession: false } });

const CSV_PATH = process.argv[2];
if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
  console.error("Usage: node scripts/_apply-field-mappings.mjs <csv-path> [--apply-disables] [--dry-run]");
  process.exit(2);
}
const APPLY_DISABLES = process.argv.includes("--apply-disables");
const DRY_RUN = process.argv.includes("--dry-run");

function parseCsv(text) {
  const lines = text.split("\n").filter(Boolean);
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('"PARTIAL')) continue;
    // Naive CSV parser — won't handle commas in quoted fields. Audit
    // script keeps cells simple (no embedded commas in id_field etc).
    const cells = line.split(",");
    const obj = {};
    header.forEach((h, idx) => (obj[h] = cells[idx] ?? ""));
    rows.push(obj);
  }
  return rows;
}

const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf-8"));
console.log(`[apply] ${rows.length} rows in CSV`);

const buckets = { UPDATE: [], KEEP_AS_IS: [], DEAD_404: [], DEAD_5XX: [], EMPTY: [], AUTH_REQUIRED: [], "STALE_>90d": [] };
for (const r of rows) {
  const b = buckets[r.recommendation];
  if (b) b.push(r);
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v.length}`);

if (DRY_RUN) {
  console.log("\n[apply] --dry-run — no DB writes. Sample UPDATE row:");
  console.log(buckets.UPDATE[0] ?? "(none)");
  process.exit(0);
}

let updated = 0;
let failed = 0;
// Audit CSV uses `addr_field` but the permit_sources column is `address_field`.
// Map audit-side keys → table-side keys for the patch.
const AUDIT_TO_TABLE = {
  id_field:      "id_field",
  type_field:    "type_field",
  status_field:  "status_field",
  addr_field:    "address_field",
  date_field:    "date_field",
  value_field:   "value_field",
  desc_field:    "desc_field",
  lat_field:     "lat_field",
  lng_field:     "lng_field",
};
for (const r of buckets.UPDATE) {
  const patch = {};
  for (const [auditKey, tableKey] of Object.entries(AUDIT_TO_TABLE)) {
    if (r[auditKey]) patch[tableKey] = r[auditKey];
  }
  if (Object.keys(patch).length === 0) continue;
  const { error } = await s.from("permit_sources").update(patch).eq("source_key", r.source_key);
  if (error) {
    console.error(`[apply] FAIL ${r.source_key}: ${error.message}`);
    failed++;
    continue;
  }
  updated++;
  if (updated % 200 === 0) console.log(`[apply] ${updated} updated …`);
}
console.log(`[apply] ${updated} UPDATEs applied, ${failed} failures`);

if (APPLY_DISABLES) {
  const dead = [...buckets.DEAD_404, ...buckets.DEAD_5XX, ...buckets.EMPTY];
  console.log(`[apply] --apply-disables: setting enabled=false on ${dead.length} dead/empty rows`);
  let disabled = 0;
  for (const r of dead) {
    // permit_sources doesn't carry last_error / last_error_at columns;
    // we capture the disable reason in `notes` instead so it's queryable.
    const { error } = await s
      .from("permit_sources")
      .update({
        enabled: false,
        notes: `disabled ${new Date().toISOString().slice(0, 10)} via field-mapping audit: ${r.recommendation}`,
      })
      .eq("source_key", r.source_key);
    if (!error) disabled++;
  }
  console.log(`[apply] ${disabled} sources disabled`);
} else {
  console.log("[apply] dead rows NOT auto-disabled. Re-run with --apply-disables to flip them off.");
}

process.exit(failed > 0 ? 1 : 0);
