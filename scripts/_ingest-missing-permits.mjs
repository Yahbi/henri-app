#!/usr/bin/env node
/**
 * Bulk-insert ACCEPTed missing-permit endpoints into permit_sources.
 *
 * Reads the CSV produced by _discover-missing-permits.ts and inserts
 * one row per `verdict = ACCEPT` line. Other verdicts are NOT inserted
 * but get summarized for the operator.
 *
 * For verdict = AUTH_REQUIRED rows: inserts with `enabled = false` and
 * `discovered_via = 'phase4_backlog_2026-05-08'` so the Hetzner side
 * can pick them up later for scraping work.
 *
 * Usage:
 *   node scripts/_ingest-missing-permits.mjs <csv-path>
 *   node scripts/_ingest-missing-permits.mjs <csv> --include-backlog
 *   node scripts/_ingest-missing-permits.mjs <csv> --dry-run
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
  console.error("Usage: node scripts/_ingest-missing-permits.mjs <csv-path> [--include-backlog] [--dry-run]");
  process.exit(2);
}
const INCLUDE_BACKLOG = process.argv.includes("--include-backlog");
const DRY_RUN = process.argv.includes("--dry-run");
// Non-permit entries (parcel/assessor/lien/license_roster/planning_pipeline)
// are skipped by default since permit_sources is the wrong table for them.
// Pass --include-non-permit to upsert them with discovered_via='non_permit_layer_2026-05-08'
// so a follow-up migration can route them to dedicated tables (parcel_sources etc.).
const INCLUDE_NON_PERMIT = process.argv.includes("--include-non-permit");

function parseCsv(text) {
  const lines = text.split("\n").filter(Boolean);
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.startsWith('"PARTIAL')) continue;
    // Naive split — discover script keeps cells simple (commas only in the
    // quoted sample_field_names cell which is wrapped). Robust path: a
    // proper CSV parser, but this is good enough for the discover output.
    const cells = [];
    let cur = "", inQ = false;
    for (const ch of ln) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    const obj = {};
    header.forEach((h, idx) => (obj[h] = cells[idx] ?? ""));
    rows.push(obj);
  }
  return rows;
}

const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf-8"));

/**
 * Derive a verdict bucket from the CSV. The ingester originally expected
 * a `verdict` column emitted by `_discover-missing-permits.ts`, but the
 * OpenClaw-style CSV (the one from agent dispatch 2026-05-08) doesn't
 * carry that column — instead it carries auth_required + http_status +
 * freshness_days + sample_record_count, which together yield the same
 * bucket. If `verdict` is present we trust it; otherwise we derive.
 */
function deriveVerdict(r) {
  if (r.verdict) return r.verdict;
  const auth   = (r.auth_required ?? "").toLowerCase().trim();
  const status = (r.http_status ?? "").trim();
  const fresh  = parseInt(r.freshness_days ?? "", 10);
  const url    = (r.endpoint_url ?? "").trim();
  const cnt    = Number(r.sample_record_count) || 0;
  if (!url || url === "NONE_FOUND" || url.toLowerCase() === "n/a")
    return "REJECT_NONE_FOUND";
  if (auth === "yes" || auth === "scrape" || auth === "captcha")
    return "AUTH_REQUIRED";
  if (status && status !== "200" && status !== "201")
    return `REJECT_HTTP_${status}`;
  if (Number.isFinite(fresh) && fresh > 90)
    return "REJECT_STALE";
  if (cnt <= 0)
    return "REJECT_EMPTY";
  return "ACCEPT";
}

const buckets = {};
for (const r of rows) {
  const v = deriveVerdict(r);
  buckets[v] = (buckets[v] ?? []);
  buckets[v].push(r);
}
console.log(`[ingest] ${rows.length} rows in CSV. Verdict breakdown:`);
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v.length}`);

const accepted = buckets["ACCEPT"] ?? [];
const backlog = buckets["AUTH_REQUIRED"] ?? [];

// Split each bucket by data_layer so non-permit entries can be routed
// or skipped independently. Default 'permit' when missing.
function partitionByLayer(rows) {
  const permit = [];
  const nonPermit = [];
  for (const r of rows) {
    const layer = (r.data_layer ?? "permit").toLowerCase();
    if (layer === "permit" || layer === "") permit.push(r);
    else nonPermit.push(r);
  }
  return { permit, nonPermit };
}
const acceptedPermit = partitionByLayer(accepted).permit;
const acceptedNonPermit = partitionByLayer(accepted).nonPermit;
const backlogPermit = partitionByLayer(backlog).permit;
const backlogNonPermit = partitionByLayer(backlog).nonPermit;
console.log(`[ingest] data_layer split: ACCEPT permit=${acceptedPermit.length} non-permit=${acceptedNonPermit.length}; AUTH_REQUIRED permit=${backlogPermit.length} non-permit=${backlogNonPermit.length}`);

function rowToInsert(r, opts = {}) {
  const sourceKey = `${r.state}-${r.jurisdiction}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 80);
  // permit_sources schema requires NOT NULL: name + auth + field_mapping_status + enabled + error_count.
  // jurisdiction_type isn't a column — encode it in notes if present.
  const noteParts = [];
  if (r.evidence_url)      noteParts.push(`evidence: ${r.evidence_url}`);
  if (r.jurisdiction_type) noteParts.push(`type: ${r.jurisdiction_type}`);
  return {
    source_key: sourceKey,
    name: r.jurisdiction || r.state || sourceKey,
    state: r.state,
    jurisdiction: r.jurisdiction,
    endpoint: r.endpoint_url,
    source_type: r.platform === "arcgis" ? "arcgis" : r.platform === "socrata" ? "socrata" : "scrape",
    auth: opts.auth ?? "none",
    enabled: opts.enabled ?? true,
    // 'unknown' is in the field_mapping_status enum; the auditor in the
    // next pass flips this to 'verified' once the schema is probed.
    field_mapping_status: "unknown",
    discovered_via: opts.discoveredVia ?? "discovery_2026-05-08",
    last_count: Number(r.sample_record_count) || 0,
    error_count: 0,
    notes: noteParts.length ? noteParts.join(" | ") : null,
  };
}

if (DRY_RUN) {
  console.log("\n[ingest] --dry-run — no DB writes. Sample ACCEPT permit row:");
  console.log(rowToInsert(acceptedPermit[0] ?? {}));
  if (INCLUDE_BACKLOG) {
    console.log("\n[ingest] sample backlog (permit) row:");
    console.log(rowToInsert(backlogPermit[0] ?? {}, { enabled: false, discoveredVia: "phase4_backlog_2026-05-08" }));
  }
  if (INCLUDE_NON_PERMIT) {
    console.log("\n[ingest] sample non-permit ACCEPT row:");
    console.log(rowToInsert(acceptedNonPermit[0] ?? {}, { discoveredVia: "non_permit_layer_2026-05-08", enabled: false }));
  }
  process.exit(0);
}

let inserted = 0;
let skipped = 0;
for (const r of acceptedPermit) {
  const payload = rowToInsert(r);
  const { error } = await s.from("permit_sources").upsert(payload, { onConflict: "source_key" });
  if (error) {
    console.error(`[ingest] FAIL ${payload.source_key}: ${error.message}`);
    skipped++;
  } else {
    inserted++;
  }
}
console.log(`[ingest] ${inserted} ACCEPT permit rows upserted (${skipped} failed)`);

if (INCLUDE_BACKLOG && backlogPermit.length) {
  let bl = 0;
  for (const r of backlogPermit) {
    const payload = rowToInsert(r, { enabled: false, discoveredVia: "phase4_backlog_2026-05-08" });
    const { error } = await s.from("permit_sources").upsert(payload, { onConflict: "source_key" });
    if (!error) bl++;
  }
  console.log(`[ingest] ${bl} AUTH_REQUIRED permit rows added to Phase 4 backlog (enabled=false)`);
}

// Non-permit entries (parcel / assessor / lien / license_roster / planning_pipeline)
// only get inserted when --include-non-permit is passed. They go in with
// enabled=false + a marker discovered_via, so a follow-up migration can
// route them to dedicated tables (parcel_sources etc.) when those exist.
if (INCLUDE_NON_PERMIT) {
  const nonPermitAll = [...acceptedNonPermit, ...(INCLUDE_BACKLOG ? backlogNonPermit : [])];
  let np = 0;
  for (const r of nonPermitAll) {
    const layer = (r.data_layer ?? "unknown").toLowerCase();
    const payload = rowToInsert(r, {
      enabled: false,
      discoveredVia: `non_permit_layer_${layer}_2026-05-08`,
    });
    const { error } = await s.from("permit_sources").upsert(payload, { onConflict: "source_key" });
    if (!error) np++;
    else console.error(`[ingest] non-permit FAIL ${payload.source_key}: ${error.message}`);
  }
  console.log(`[ingest] ${np} non-permit entries staged in permit_sources (enabled=false). Migrate to dedicated tables when available.`);
} else if (acceptedNonPermit.length || backlogNonPermit.length) {
  console.log(`[ingest] ${acceptedNonPermit.length + backlogNonPermit.length} non-permit entries SKIPPED. Re-run with --include-non-permit to stage them in permit_sources (enabled=false) for later migration.`);
}

process.exit(skipped > 0 ? 1 : 0);
