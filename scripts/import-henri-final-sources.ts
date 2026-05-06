/**
 * Import the data team's FINAL no-auth catalog into `permit_sources`.
 *
 * Source files (Data Henri 3, 2026-04-22 sweep):
 *   C:/Users/yabis/Desktop/Data Henri 3/Henri_permit_sources_FINAL_no_auth.csv
 *     — 3,450 verified permit endpoints (HTTP 200 + ≥1 record)
 *   C:/Users/yabis/Desktop/Data Henri 3/Henri_assessor_sources_FINAL_no_auth.csv
 *     — 65 hand-curated assessor endpoints
 *
 * Why this importer exists:
 *   The earlier dh3-* importers ingested 356k candidate rows but most were
 *   never field-probed and only 227k are flagged enabled=true. The data
 *   team's 2026-04-22 deliverable is the authoritative no-auth list — every
 *   row was probed live and confirmed responsive. This importer does two
 *   things:
 *     1. Upsert each FINAL row by source_key (matches the dh3-database-
 *        complete buildKey() shape so re-running merges with prior imports
 *        instead of duplicating).
 *     2. For every row that's `_verify_status='verified_live'`, set
 *        enabled=true so the scrape pool picks it up immediately.
 *
 * Idempotent: re-running upserts on `source_key`, ignores already-landed
 *   rows. Safe to interleave with import-dh3-database-complete et al.
 *
 * Provenance columns from migration 00052 (discovered_via, imported_at,
 * notes) are written when present and silently dropped otherwise — the
 * Supabase JS client tolerates unknown columns by virtue of PostgREST's
 * handling of missing-target. The enabled-flip is the load-bearing
 * signal; provenance is a metadata nice-to-have.
 *
 * Usage:
 *   npx tsx scripts/import-henri-final-sources.ts permits
 *   npx tsx scripts/import-henri-final-sources.ts assessors
 *   npx tsx scripts/import-henri-final-sources.ts both       # default
 *
 * Env:
 *   IMPORT_LIMIT=200   # smoke test
 *   DRY_RUN=1          # parse + report stats; do not write
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SR) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const s = createClient(SUPABASE_URL, SR, { auth: { persistSession: false } });

const IMPORT_LIMIT = Number(process.env.IMPORT_LIMIT ?? 0);
const DRY_RUN = process.env.DRY_RUN === "1";

const PERMITS_CSV =
  "C:/Users/yabis/Desktop/Data Henri 3/Henri_permit_sources_FINAL_no_auth.csv";
const ASSESSORS_CSV =
  "C:/Users/yabis/Desktop/Data Henri 3/Henri_assessor_sources_FINAL_no_auth.csv";

/* ── CSV parser (verbatim from sibling importers) ─────────────────────── */

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"' && raw[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && raw[i + 1] === "\n") i++;
        row.push(cur);
        if (row.some((v) => v.length > 0)) rows.push(row);
        row = [];
        cur = "";
      } else cur += c;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (row.some((v) => v.length > 0)) rows.push(row);
  }
  return rows;
}

function readCsvObjects(filePath: string): Array<Record<string, string>> {
  if (!fs.existsSync(filePath)) {
    console.warn(`  [csv] file not found: ${filePath}`);
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const grid = parseCsv(raw);
  if (grid.length < 2) return [];
  const header = grid[0].map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? "").trim();
    });
    out.push(obj);
  }
  return out;
}

/* ── Normalizers ──────────────────────────────────────────────────────── */

function slug(v: string): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

type Platform = "arcgis" | "socrata" | "ckan" | "csv" | "html" | "unknown";

function platformFromAccessMethod(am: string, url: string): Platform {
  const a = (am ?? "").toLowerCase();
  const u = (url ?? "").toLowerCase();
  if (a.includes("socrata")) return "socrata";
  if (a.includes("arcgis")) return "arcgis";
  if (a.includes("ckan")) return "ckan";
  if (a.includes("carto")) return "ckan";
  if (a.includes("bulk download") || a.includes("csv") || u.endsWith(".csv")) return "csv";
  if (a.includes("html")) return "html";
  if (u.includes("/resource/") && u.endsWith(".json")) return "socrata";
  if (u.includes("featureserver") || u.includes("mapserver")) return "arcgis";
  if (u.includes("/api/3/action/")) return "ckan";
  return "unknown";
}

function buildKey(
  platform: string,
  state: string,
  jurisdiction: string,
  endpoint: string,
): string {
  const epHash = slug(endpoint).slice(-12);
  return `${platform}:${state}:${slug(jurisdiction)}:${epHash}`.slice(0, 200);
}

/* ── Adapters ─────────────────────────────────────────────────────────── */

interface SourceRow {
  source_key: string;
  name: string;
  state: string;
  city: string | null;
  jurisdiction: string;
  endpoint: string;
  source_type: Platform;
  auth: string;
  enabled: boolean;
  // Provenance (00052) — set when columns exist; PostgREST drops them
  // safely when not. We always include them; the migration apply path
  // backfills these rows once 00052 lands.
  discovered_via?: string;
  imported_at?: string;
  notes?: string;
}

function adaptPermitsRow(r: Record<string, string>): SourceRow | null {
  const jurisdiction = r["01_jurisdiction"] ?? "";
  const state = (r["04_state"] ?? "").toUpperCase();
  const endpoint = r["11_endpoint_url"] ?? "";
  if (!endpoint || !state) return null;
  if (!/^https?:\/\//i.test(endpoint)) return null;

  const accessMethod = r["10_access_method"] ?? "";
  const platform = platformFromAccessMethod(accessMethod, endpoint);
  const authReq = (r["12_auth_required"] ?? "").trim().toUpperCase();
  const auth = authReq === "Y" ? "required" : "none";
  const enabled =
    (r["_verify_status"] ?? "").toLowerCase() === "verified_live";

  const type = (r["03_type"] ?? "").toLowerCase();
  const city = type === "city" ? jurisdiction : null;

  const tier = r["24_henri_priority_tier"] ?? "";
  const verifyDate = r["25_verified_date"] ?? r["_verify_records"] ?? "";
  const records = r["_verify_records"] ?? "";

  return {
    source_key: buildKey(platform, state, jurisdiction, endpoint),
    name: `${jurisdiction} permits`,
    state,
    city,
    jurisdiction,
    endpoint,
    source_type: platform,
    auth,
    enabled,
    discovered_via: "henri_final_no_auth_2026_04_22",
    imported_at: new Date().toISOString(),
    notes: [
      tier && `tier=${tier}`,
      accessMethod && `access=${accessMethod}`,
      records && `records=${records}`,
      verifyDate && `verified=${verifyDate}`,
    ]
      .filter(Boolean)
      .join("; "),
  };
}

function adaptAssessorRow(r: Record<string, string>): SourceRow | null {
  const jurisdiction = r["01_jurisdiction"] ?? "";
  const state = (r["04_state"] ?? "").toUpperCase();
  const endpoint = r["11_endpoint_url"] ?? "";
  if (!endpoint || !state) return null;
  if (!/^https?:\/\//i.test(endpoint)) return null;

  const accessMethod = r["10_access_method"] ?? "";
  const platform = platformFromAccessMethod(accessMethod, endpoint);
  const authReq = (r["12_auth_required"] ?? "").toLowerCase();
  const auth =
    authReq === "none" || authReq === "" || authReq === "n" ? "none" : "required";

  const type = (r["03_assessing_authority"] ?? "").toLowerCase();
  const city = type.includes("city") ? jurisdiction : null;

  const tier = r["27_henri_priority_tier"] ?? "";
  const verifyDate = r["28_verified_date"] ?? "";
  const platformLabel = r["09_software_platform"] ?? "";

  return {
    source_key: buildKey(`assessor:${platform}`, state, jurisdiction, endpoint),
    name: `${jurisdiction} assessor`,
    state,
    city,
    jurisdiction,
    endpoint,
    source_type: platform,
    auth,
    // Assessor catalog has no _verify_status column — they're hand-curated
    // and presumed live. Mark enabled=true so the scrape pool can pick
    // them up; the orchestrator's per-source error counting demotes broken
    // ones the same way it does any other source.
    enabled: true,
    discovered_via: "henri_final_no_auth_2026_04_22",
    imported_at: new Date().toISOString(),
    notes: [
      "kind=assessor",
      tier && `tier=${tier}`,
      accessMethod && `access=${accessMethod}`,
      platformLabel && `platform_label=${platformLabel}`,
      verifyDate && `verified=${verifyDate}`,
    ]
      .filter(Boolean)
      .join("; "),
  };
}

/* ── Upsert with graceful provenance-column fallback ──────────────────── */

async function upsertChunk(
  client: SupabaseClient,
  rows: SourceRow[],
): Promise<{ ok: number; err: number; errMsg?: string }> {
  if (rows.length === 0) return { ok: 0, err: 0 };
  // Try with provenance columns first. If 00052 isn't applied, the second
  // attempt drops them and retries. This is the same client-side fallback
  // pattern useLeads uses for the 00039/00044 wide select.
  const { error } = await client
    .from("permit_sources")
    .upsert(rows, { onConflict: "source_key", ignoreDuplicates: false });
  if (!error) return { ok: rows.length, err: 0 };
  if (/discovered_via|imported_at|notes/i.test(error.message)) {
    const stripped = rows.map((r) => {
      const { discovered_via: _dv, imported_at: _ia, notes: _n, ...rest } = r;
      void _dv; void _ia; void _n;
      return rest;
    });
    const retry = await client
      .from("permit_sources")
      .upsert(stripped, { onConflict: "source_key", ignoreDuplicates: false });
    if (!retry.error) return { ok: rows.length, err: 0 };
    return { ok: 0, err: rows.length, errMsg: retry.error.message };
  }
  return { ok: 0, err: rows.length, errMsg: error.message };
}

async function importFile(
  filePath: string,
  adapter: (r: Record<string, string>) => SourceRow | null,
  label: string,
): Promise<void> {
  console.log(`\n── ${label} ${filePath} ─────────────────────`);
  const csv = readCsvObjects(filePath);
  console.log(`  csv rows: ${csv.length.toLocaleString()}`);
  if (csv.length === 0) return;

  const adapted: SourceRow[] = [];
  let skipped = 0;
  for (const r of csv) {
    const out = adapter(r);
    if (out) adapted.push(out);
    else skipped++;
  }
  console.log(`  adapted : ${adapted.length.toLocaleString()} (skipped ${skipped} for missing endpoint/state)`);
  // Dedup by source_key WITHIN this batch (assessor catalog has 1
  // duplicate; cheap defensive measure).
  const seen = new Map<string, SourceRow>();
  for (const r of adapted) seen.set(r.source_key, r);
  const unique = [...seen.values()];
  if (unique.length < adapted.length) {
    console.log(`  deduped : ${unique.length.toLocaleString()} (dropped ${adapted.length - unique.length} duplicates)`);
  }
  const enabledCount = unique.filter((r) => r.enabled).length;
  console.log(`  enabled : ${enabledCount.toLocaleString()} (verified_live)`);

  const todo = IMPORT_LIMIT > 0 ? unique.slice(0, IMPORT_LIMIT) : unique;
  if (DRY_RUN) {
    console.log(`  DRY_RUN  — sample row:`, JSON.stringify(todo[0], null, 2));
    return;
  }

  const CHUNK = 500;
  let ok = 0;
  let err = 0;
  let lastErr = "";
  for (let i = 0; i < todo.length; i += CHUNK) {
    const slice = todo.slice(i, i + CHUNK);
    const res = await upsertChunk(s, slice);
    ok += res.ok;
    err += res.err;
    if (res.errMsg) lastErr = res.errMsg;
    if (i % (CHUNK * 5) === 0 || i + CHUNK >= todo.length) {
      console.log(`  upsert  : ${(ok + err).toLocaleString()} / ${todo.length.toLocaleString()} (ok=${ok}, err=${err})`);
    }
  }
  console.log(`  done    : +${ok.toLocaleString()} upserted, ${err} errors${lastErr ? ` — last: ${lastErr.slice(0, 200)}` : ""}`);
}

async function main() {
  const arg = (process.argv[2] ?? "both").toLowerCase();
  console.log(`── Henri FINAL no-auth catalog import ─────────────────`);
  console.log(`mode: ${arg}, dry_run: ${DRY_RUN}, limit: ${IMPORT_LIMIT || "none"}`);

  if (arg === "permits" || arg === "both") {
    await importFile(PERMITS_CSV, adaptPermitsRow, "permits");
  }
  if (arg === "assessors" || arg === "both") {
    await importFile(ASSESSORS_CSV, adaptAssessorRow, "assessors");
  }
  console.log(`\nDone.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
