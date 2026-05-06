/**
 * Bulk import of `Data for Onsite/permit_records/*.csv.gz` into the live
 * `permits` table.
 *
 * Why this exists: the archive holds ~5 GB of compressed permit records
 * across all 50 states (101 files, ~2.4M rows uncompressed in the AK file
 * alone). The existing `/api/cron/permits` route fetches LIVE from
 * municipal endpoints and inserts a few hundred per run; it can't move
 * historical data at scale. This is the offline batch loader.
 *
 * Constraints we work around:
 *   - No unique constraint on `permits` (probed live) — so we pre-check
 *     existence per batch instead of using ON CONFLICT.
 *   - `permit_type` is an enum: addition / commercial / demolition /
 *     new_construction / other / renovation / repair / residential.
 *     Raw values from the archive get normalized to the enum or `other`.
 *   - `source_type` is an enum: accela / arcgis / ckan / socrata.
 *   - Migration 00039 (contact_provenance) is NOT applied yet, so we
 *     do NOT write contact_source / contact_confidence / contact_extracted_at.
 *     The 27 columns currently on `permits` are the full target schema.
 *
 * Filters (skip these rows — they're source-discovery probes, not real permits):
 *   - permit_number is empty
 *   - description starts with "Test" or "Notes" exactly
 *   - state is empty
 *
 * Resumability: per-state checkpoint at scripts/.import-state.json.
 * Re-running picks up from the last completed file.
 *
 * Usage:
 *   npx tsx scripts/import-permit-archive.ts                  # all states
 *   npx tsx scripts/import-permit-archive.ts --state AK       # one state
 *   npx tsx scripts/import-permit-archive.ts --limit 10000    # test slice
 *   npx tsx scripts/import-permit-archive.ts --reset          # clear checkpoint
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { createGunzip } from "node:zlib";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !KEY) {
  console.error("Missing SUPABASE env vars in .env.local");
  process.exit(1);
}
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

/* ── CLI ──────────────────────────────────────────────────────────── */
const args = new Set(process.argv.slice(2));
const stateFlag = ((): string | null => {
  const idx = process.argv.indexOf("--state");
  return idx >= 0 ? (process.argv[idx + 1] ?? null) : null;
})();
const limitFlag = ((): number => {
  const idx = process.argv.indexOf("--limit");
  return idx >= 0 ? Number(process.argv[idx + 1]) || 0 : 0;
})();
const resetFlag = args.has("--reset");
const dryRunFlag = args.has("--dry-run");

/* ── Paths ────────────────────────────────────────────────────────── */
const ARCHIVE_DIR =
  "C:\\Users\\yabis\\Desktop\\Data for Onsite\\permit_records";
const STATE_FILE = path.resolve(__dirname, ".import-state.json");

/* ── Checkpoint ───────────────────────────────────────────────────── */
interface ImportState {
  completed: string[]; // file basenames already processed
  totals: {
    parsed: number;
    skipped: number;
    inserted: number;
    duplicates: number;
    errors: number;
  };
  startedAt: string;
}
function loadState(): ImportState {
  if (resetFlag || !fs.existsSync(STATE_FILE)) {
    return {
      completed: [],
      totals: { parsed: 0, skipped: 0, inserted: 0, duplicates: 0, errors: 0 },
      startedAt: new Date().toISOString(),
    };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as ImportState;
}
function saveState(s: ImportState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

/* ── CSV streaming parser (RFC 4180 quoted-field aware) ──────────── */
/**
 * Parse a single CSV line, handling double-quoted fields with embedded
 * commas / newlines / escaped quotes. The archive's `description` and
 * `contractor` fields routinely have commas, so naive split(",") fails.
 *
 * Note: this assumes each row is on a single line. The archive files
 * appear to honor that; if a row spans newlines inside a quoted field,
 * the readline split would corrupt it. Empirical sampling shows
 * single-line rows are the norm.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

/* ── Type normalization ───────────────────────────────────────────── */
const PERMIT_TYPE_ENUM = new Set([
  "addition",
  "commercial",
  "demolition",
  "new_construction",
  "other",
  "renovation",
  "repair",
  "residential",
]);
function normalizePermitType(raw: string): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "other";
  if (PERMIT_TYPE_ENUM.has(v)) return v;
  if (/demo/.test(v)) return "demolition";
  if (/new\s*construct|new\s*build/.test(v)) return "new_construction";
  if (/addition|add\b/.test(v)) return "addition";
  if (/(reno|remodel|alter|tenant|interior)/.test(v)) return "renovation";
  if (/(repair|fix|replace)/.test(v)) return "repair";
  if (/(commercial|business|office|industrial|retail)/.test(v)) return "commercial";
  if (/(residential|home|house|sfr|single.family|dwelling)/.test(v)) return "residential";
  return "other";
}

const SOURCE_TYPE_ENUM = new Set(["accela", "arcgis", "ckan", "socrata"]);
function normalizeSourceType(raw: string): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (SOURCE_TYPE_ENUM.has(v)) return v;
  if (/socrata/.test(v)) return "socrata";
  if (/arcgis/.test(v)) return "arcgis";
  if (/accela/.test(v)) return "accela";
  if (/ckan/.test(v)) return "ckan";
  return "arcgis"; // archive is dominated by arcgis sources; safe default
}

const STATUS_ENUM = new Set(["expired", "final", "issued", "revoked", "submitted"]);
function normalizeStatus(raw: string): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (STATUS_ENUM.has(v)) return v;
  if (/issued|currently\s*permitted|active/.test(v)) return "issued";
  if (/final|closed|completed|certificate.of.occupancy|c\.?o\b/.test(v)) return "final";
  if (/expir|cancel/.test(v)) return "expired";
  if (/revoke|withdraw|denied/.test(v)) return "revoked";
  if (/submit|applied|pending|under\s*review|received/.test(v)) return "submitted";
  return null;
}

/* ── Date parsing ─────────────────────────────────────────────────── */
function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  // Common formats from archive: "2024-01-15", "2024-01-15T10:30:00Z",
  // "01/15/2024", "1/15/2024 10:30:00 AM"
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  // Reject dates outside [1990, now+1y] — archives sometimes have epoch-0
  // or year-9999 placeholders.
  const d = new Date(t);
  const year = d.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  return d.toISOString();
}

/* ── Numeric parsing ──────────────────────────────────────────────── */
function parseNumber(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/[\$,]/g, "").trim();
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return n;
}
function parseLatLng(raw: string, kind: "lat" | "lng"): number | null {
  const n = parseNumber(raw);
  if (n == null) return null;
  if (kind === "lat" && (n < -90 || n > 90)) return null;
  if (kind === "lng" && (n < -180 || n > 180)) return null;
  if (n === 0) return null; // archives use 0 for "unknown"
  return n;
}

/* ── Row mapping ──────────────────────────────────────────────────── */
type ArchiveRow = {
  source_url: string;
  source_type: string;
  state: string;
  jurisdiction: string;
  permit_number: string;
  permit_type: string;
  description: string;
  status: string;
  address: string;
  city: string;
  zip_code: string;
  latitude: string;
  longitude: string;
  issue_date: string;
  estimated_value: string;
  contractor: string;
};

interface PermitInsert {
  source_id: string;
  source_type: string;
  source_city: string;
  state: string;
  city: string;
  zip: string | null;
  permit_number: string;
  permit_type: string;
  description: string | null;
  status: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  issued_date: string | null;
  estimated_value: number | null;
  contractor_name: string | null;
  raw_json: Record<string, unknown>;
}

function mapRow(r: ArchiveRow): PermitInsert | null {
  // Pre-filters
  if (!r.permit_number?.trim()) return null;
  if (!r.state?.trim()) return null;
  const desc = (r.description ?? "").trim();
  if (desc === "Test" || desc === "Notes") return null;
  if (r.address?.trim() === "Test") return null;

  // Defensive string truncation to match every known varchar limit on
  // the live `permits` schema. Probed limits (2026-04-27):
  //   state varchar(2), zip varchar(5), permit_number varchar(100),
  //   source_city varchar(?), source_id text, address text,
  //   contractor_name text. The `varchar(5) overflow` we hit on AZ
  //   was almost certainly ZIP+4 strings ("78704-1234") in zip_code.
  // We slice every fixed-length field at the SQL limit so a long row
  // can't kill its batch.
  return {
    source_id: (r.source_url?.trim() || `${r.state}_${r.jurisdiction}_unknown`).slice(0, 1024),
    source_type: normalizeSourceType(r.source_type),
    source_city: (r.jurisdiction?.trim() || r.city?.trim() || "unknown").slice(0, 100),
    state: r.state.trim().toUpperCase().slice(0, 2),
    city: (r.city?.trim() || r.jurisdiction?.trim() || "unknown").slice(0, 100),
    // Take only the first 5 digits of any zip — drops ZIP+4 suffixes
    // like "78704-1234". If the cleaned value isn't a valid 5-digit
    // string, drop it rather than insert garbage.
    zip: ((): string | null => {
      const raw = (r.zip_code ?? "").trim();
      if (!raw) return null;
      const m = raw.match(/^(\d{5})/);
      return m ? m[1] : null;
    })(),
    permit_number: r.permit_number.trim().slice(0, 100),
    permit_type: normalizePermitType(r.permit_type),
    description: desc ? desc.slice(0, 4000) : null,
    // status is NOT NULL on `permits` — default to 'submitted' when the
    // archive's value is empty or doesn't map. 'submitted' is the most
    // permissive bucket — matches "applied" / "received" / "pending".
    status: normalizeStatus(r.status) ?? "submitted",
    address: r.address ? r.address.trim().slice(0, 500) : null,
    latitude: parseLatLng(r.latitude, "lat"),
    longitude: parseLatLng(r.longitude, "lng"),
    issued_date: parseDate(r.issue_date),
    // estimated_value is BIGINT in the live schema, but the archive
    // sometimes ships decimals (e.g. "338098.01"). Round to nearest
    // integer so PostgREST doesn't reject the row. Reject negatives
    // and absurdly large values (>$10B) outright — likely upstream junk.
    estimated_value: ((): number | null => {
      const n = parseNumber(r.estimated_value);
      if (n == null) return null;
      if (n < 0 || n > 1e10) return null;
      return Math.round(n);
    })(),
    contractor_name: r.contractor ? r.contractor.trim().slice(0, 500) : null,
    raw_json: { ...r, _imported_from: "permit_records_archive" },
  };
}

/* ── Batch insert with pre-existence check ───────────────────────── */
/** True when an error message indicates a duplicate-key collision on
 *  the live unique constraint. */
function isDuplicateError(msg: string): boolean {
  return /duplicate key|uq_permits_source|already exists/i.test(msg);
}

async function flushBatch(
  batch: PermitInsert[],
  state: ImportState,
): Promise<void> {
  if (batch.length === 0) return;
  if (dryRunFlag) {
    state.totals.inserted += batch.length;
    return;
  }

  // No pre-check. The previous version did a SELECT IN(...) over 500
  // long source-url strings, which timed out PostgREST on the 933k-row
  // permits table. Instead we rely on the live unique constraint
  // `uq_permits_source` (source_id + permit_number) to reject dupes —
  // bulk insert first, fall through to per-row only when the batch
  // fails (which costs one round-trip per row in the failing batch but
  // only happens on dupe-heavy regions).
  const { error } = await supabase.from("permits").insert(batch);
  if (!error) {
    state.totals.inserted += batch.length;
    return;
  }
  if (!isDuplicateError(error.message)) {
    console.warn(`  batch insert error: ${error.message.slice(0, 200)}`);
  }

  // Per-row fallback. Distinguish dupes from real errors so the tally
  // is honest.
  let inserted = 0;
  let dupes = 0;
  let errors = 0;
  for (const row of batch) {
    const { error: rowErr } = await supabase.from("permits").insert([row]);
    if (!rowErr) {
      inserted++;
    } else if (isDuplicateError(rowErr.message)) {
      dupes++;
    } else {
      errors++;
      if (errors <= 3) {
        console.warn(`  row error: ${rowErr.message.slice(0, 160)}`);
      }
    }
  }
  state.totals.inserted += inserted;
  state.totals.duplicates += dupes;
  state.totals.errors += errors;
}

/* ── Process one .csv.gz file ─────────────────────────────────────── */
async function processFile(filePath: string, state: ImportState, fileLimit: number): Promise<void> {
  const base = path.basename(filePath);
  if (state.completed.includes(base)) {
    console.log(`  [${base}] already done, skipping`);
    return;
  }

  console.log(`==> ${base}`);
  const t0 = Date.now();

  // Some archive files are truncated (Z_BUF_ERROR on gunzip). Suppress
  // 'error' on both streams and bail gracefully so one bad file doesn't
  // kill the whole import — record it as completed-with-error so we
  // don't retry it on the next run.
  const fileStream = fs.createReadStream(filePath);
  const gunzip = createGunzip();
  let aborted = false;
  fileStream.on("error", (e) => {
    aborted = true;
    console.warn(`  [${base}] read error: ${e.message}`);
  });
  gunzip.on("error", (e) => {
    aborted = true;
    console.warn(`  [${base}] gunzip error: ${(e as Error).message} — partial data accepted`);
  });
  const stream = fileStream.pipe(gunzip);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] | null = null;
  let parsed = 0;
  let skipped = 0;
  let batchedFile = 0;
  const batch: PermitInsert[] = [];
  const BATCH = 500;

  try {
   for await (const line of rl) {
    if (!line.trim()) continue;
    if (aborted) break;
    const cells = parseCsvLine(line);
    if (!header) {
      header = cells.map((c) => c.trim().toLowerCase());
      continue;
    }
    parsed++;
    state.totals.parsed++;
    if (fileLimit > 0 && batchedFile >= fileLimit) break;

    // Build typed row from header positions
    const r: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) r[header[i]] = cells[i] ?? "";

    const mapped = mapRow(r as unknown as ArchiveRow);
    if (!mapped) {
      skipped++;
      state.totals.skipped++;
      continue;
    }
    batch.push(mapped);
    batchedFile++;
    if (batch.length >= BATCH) {
      await flushBatch(batch, state);
      batch.length = 0;
      // Save state every 10 batches so a crash mid-file is recoverable
      if (parsed % (BATCH * 10) === 0) saveState(state);
      if (parsed % (BATCH * 4) === 0) {
        const dt = (Date.now() - t0) / 1000;
        const rate = Math.round(parsed / Math.max(dt, 0.001));
        console.log(
          `    parsed=${parsed.toLocaleString()} skipped=${skipped.toLocaleString()} ins=${state.totals.inserted.toLocaleString()} dups=${state.totals.duplicates.toLocaleString()} ${rate}/s`,
        );
      }
    }
  }
  } catch (e) {
    console.warn(`  [${base}] stream aborted: ${(e as Error).message}`);
  }
  if (batch.length > 0) await flushBatch(batch, state);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `  [${base}] done in ${dt}s — parsed=${parsed.toLocaleString()}, skipped=${skipped.toLocaleString()}`,
  );
  state.completed.push(base);
  saveState(state);
}

/* ── Main ─────────────────────────────────────────────────────────── */
async function main() {
  const state = loadState();
  console.log("== Henri permit-archive importer ==");
  console.log(`archive: ${ARCHIVE_DIR}`);
  console.log(
    `state file: ${STATE_FILE}  (resume from ${state.completed.length} completed files)`,
  );
  if (dryRunFlag) console.log("(DRY RUN — no inserts)");

  if (!fs.existsSync(ARCHIVE_DIR)) {
    console.error("archive dir not found");
    process.exit(1);
  }

  const allFiles = fs
    .readdirSync(ARCHIVE_DIR)
    .filter((f) => f.endsWith(".csv.gz"))
    // Skip macOS resource-fork siblings (`._*`) — they share the
    // .csv.gz extension but are AppleDouble metadata blobs, not real
    // gzip streams. Without this filter the importer's first pass
    // burns ~2 minutes on `._*` files that all immediately fail
    // gunzip with "incorrect header check".
    .filter((f) => !f.startsWith("._"))
    .filter((f) => !stateFlag || f.toUpperCase().startsWith(stateFlag.toUpperCase() + "_"))
    .sort();

  console.log(`files to process: ${allFiles.length}`);

  for (const f of allFiles) {
    await processFile(path.join(ARCHIVE_DIR, f), state, limitFlag);
  }

  saveState(state);
  console.log("\n== DONE ==");
  console.log(JSON.stringify(state.totals, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
