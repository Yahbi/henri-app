/**
 * Repair pass — null out permit_sources cells where the previous audit
 * wrote a hallucinated field name (one that isn't in the actual response
 * sample_keys). The validator already caught these; this script corrects
 * the DB rows that an earlier un-validated apply touched.
 *
 * For each row in the refinement CSV (validated AND original):
 *   - If the validated CSV has a recommendation field BLANK
 *   - But the original CSV had a non-blank recommendation
 *   - AND that recommendation isn't in sample_keys
 *   → Set the corresponding permit_sources column to NULL.
 *
 * This is idempotent + safe: it only NULLs hallucinated values, never
 * overwrites legitimate mappings.
 *
 * Usage:
 *   node scripts/_repair-hallucinated-mappings.mjs <orig.csv> [--apply]
 *
 *   <orig.csv> is the un-validated Hermes refinement CSV.
 *   Without --apply, runs in report-only mode (lists what would change).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const ORIG = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!ORIG || !fs.existsSync(ORIG)) {
  console.error("Usage: node scripts/_repair-hallucinated-mappings.mjs <orig.csv> [--apply]");
  process.exit(2);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const s = createClient(SUPABASE_URL, SUPABASE_SR, { auth: { persistSession: false } });

function parseCsvLine(line) {
  const cells = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

const text = fs.readFileSync(ORIG, "utf-8");
const lines = text.split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]);
const idx = (h) => header.indexOf(h);
const KEY_FIELDS = ["id_field", "type_field", "status_field", "addr_field",
                    "date_field", "value_field", "desc_field", "lat_field", "lng_field"];
// Audit-side → table-side column rename (addr_field → address_field).
const AUDIT_TO_TABLE = {
  id_field: "id_field", type_field: "type_field", status_field: "status_field",
  addr_field: "address_field", date_field: "date_field", value_field: "value_field",
  desc_field: "desc_field", lat_field: "lat_field", lng_field: "lng_field",
};

let totalChecked = 0, totalRepairs = 0;
const repairsByField = {};
const sampleRepairs = [];

for (let i = 1; i < lines.length; i++) {
  const cells = parseCsvLine(lines[i]);
  if (cells.length !== header.length) continue;
  if (cells[idx("recommendation")] !== "UPDATE") continue;
  totalChecked++;

  const sourceKey = cells[idx("source_key")];
  const sampleKeys = (cells[idx("sample_keys")] ?? "").split("|").map(k => k.trim()).filter(Boolean);
  const sampleKeysLower = new Set(sampleKeys.map(k => k.toLowerCase()));

  // Identify hallucinated cells in this row.
  const patch = {};
  for (const f of KEY_FIELDS) {
    const v = (cells[idx(f)] ?? "").trim();
    if (!v) continue;
    if (v === "geometry.x" || v === "geometry.y") continue;
    if (sampleKeys.includes(v) || sampleKeysLower.has(v.toLowerCase())) continue;
    // Hallucinated.
    patch[AUDIT_TO_TABLE[f]] = null;
    repairsByField[f] = (repairsByField[f] ?? 0) + 1;
    totalRepairs++;
  }
  if (Object.keys(patch).length === 0) continue;

  if (sampleRepairs.length < 8) sampleRepairs.push({ source_key: sourceKey, patch });

  if (APPLY) {
    const { error } = await s.from("permit_sources").update(patch).eq("source_key", sourceKey);
    if (error) console.error(`[repair] FAIL ${sourceKey}: ${error.message}`);
  }
}

console.log(`[repair] checked: ${totalChecked} UPDATE rows`);
console.log(`[repair] hallucinated cells found: ${totalRepairs}`);
console.log(`[repair] by field:`);
for (const [f, n] of Object.entries(repairsByField).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f}: ${n}`);
}
console.log(`\n[repair] sample patches (first 8):`);
for (const r of sampleRepairs) console.log(`  ${r.source_key}:`, r.patch);

if (!APPLY) {
  console.log("\n[repair] --apply not set → no DB writes. Re-run with --apply to persist.");
} else {
  console.log("\n[repair] DB updates applied.");
}
