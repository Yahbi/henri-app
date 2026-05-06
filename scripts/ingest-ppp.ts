#!/usr/bin/env npx tsx
/**
 * Ingest the SBA's Paycheck Protection Program (PPP) bulk dataset into `ppp_loans`.
 * ─────────────────────────────────────────────────────────────────────────────
 * Source:
 *   https://data.sba.gov/dataset/ppp-foia
 *     → "All PPP Loans" — a single combined CSV, ~5GB uncompressed as of 2024.
 *   SBA previously split this across dozens of files; the current release ships
 *   everything in one file. This script handles both layouts via header
 *   auto-detection (see pickIndex() below).
 *
 * Column layout (combined CSV, per SBA's published schema):
 *   LoanNumber, DateApproved, SBAOfficeCode, ProcessingMethod, BorrowerName,
 *   BorrowerAddress, BorrowerCity, BorrowerState, BorrowerZip, LoanStatusDate,
 *   LoanStatus, Term, SBAGuarantyPercentage, InitialApprovalAmount,
 *   CurrentApprovalAmount, UndisbursedAmount, FranchiseName,
 *   ServicingLenderLocationID, ServicingLenderName, ..., NAICSCode, ...,
 *   BusinessType, ..., ForgivenessAmount, ForgivenessDate.
 *
 *   Owner name + BusinessPhone + Email are REDACTED in the current combined
 *   release. They were public in the original "loans over $150k" subset; when
 *   that layout is present we pick up those extra columns too (header-driven).
 *
 * Usage:
 *   npx tsx scripts/ingest-ppp.ts /path/to/ppp_loans.csv
 *   MAX=100000  npx tsx scripts/ingest-ppp.ts /path/to/ppp_loans.csv
 *   BATCH=5000  npx tsx scripts/ingest-ppp.ts /path/to/ppp_loans.csv
 *
 * Streams via readline — DO NOT load the 5GB file into memory.
 * Upserts in 5000-row batches with onConflict: "loan_id".
 * Resumable via scripts/.ingest-ppp.state.json — checkpoints after every
 * batch flush. Killing with ctrl-C between flushes is safe: at worst you
 * reprocess one batch (and UPSERT makes that a no-op).
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "path";
loadEnv({ path: resolve(__dirname, "..", ".env.local") });

import * as fs from "fs";
import * as readline from "readline";
import { createClient } from "@supabase/supabase-js";

/* ── CLI + config ────────────────────────────────────────────────────── */

const FILE_PATH = process.argv[2];
const BATCH = Number(process.env.BATCH ?? 5000);
const MAX = Number(process.env.MAX ?? Number.POSITIVE_INFINITY);
const STATE_FILE = resolve(
  process.cwd(),
  "scripts",
  ".ingest-ppp.state.json",
);

const DOWNLOAD_INSTRUCTIONS = `
  PPP bulk dataset not found.

  Download steps:
    1. Visit https://data.sba.gov/dataset/ppp-foia
    2. Click the "All PPP Loans" resource (the full combined CSV,
       ~5GB uncompressed as of 2024).
    3. Save locally (or unzip if the resource is a .zip).

  Then re-run:
    npx tsx scripts/ingest-ppp.ts /path/to/ppp_loans.csv

  For the owner-name / business-phone columns, use the original
  "loans over $150k" release (pre-redaction). This script auto-detects
  either layout from the CSV header row.
`;

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/ingest-ppp.ts /path/to/ppp_loans.csv",
  );
  process.exit(2);
}

if (!FILE_PATH) usage();
if (!fs.existsSync(FILE_PATH)) {
  console.error(DOWNLOAD_INSTRUCTIONS);
  process.exit(2);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ── State file (resumable ingest) ───────────────────────────────────── */

interface IngestState {
  file_path: string;
  line_offset: number; // lines already processed (skip on resume)
  inserted: number; // successful upserts
  scanned: number; // total data rows read from the file
  started_at: string;
}

function loadState(): IngestState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const parsed = JSON.parse(raw) as IngestState;
      // Fresh file path → fresh state (different download).
      if (parsed.file_path === FILE_PATH) return parsed;
    }
  } catch {
    /* fall through to fresh state */
  }
  return {
    file_path: FILE_PATH!,
    line_offset: 0,
    inserted: 0,
    scanned: 0,
    started_at: new Date().toISOString(),
  };
}

function saveState(st: IngestState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
}

/* ── CSV line parser ─────────────────────────────────────────────────── */

/**
 * Parse a single CSV line. Handles RFC-4180 style quoting:
 *   - Fields may be wrapped in "..." to include commas.
 *   - Inside quotes, "" represents a literal ".
 *   - Everything else is taken verbatim (no escape processing).
 *
 * Written inline to avoid a new npm dep. SBA's CSV has plenty of quoted
 * commas in business names ("Smith, Jones & Co LLC"), so a naive
 * `line.split(",")` would shift every column right of the first company
 * with a comma in its name.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote? ("" → literal ")
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

/* ── Header-driven column index map ──────────────────────────────────── */

/**
 * Match a header label to its column index. Case-insensitive, trims
 * whitespace, and accepts any of the candidates (so we tolerate the
 * pre-redaction vs. current layout without branching on format).
 *
 * Returns -1 when no candidate matches, signalling "this field is
 * redacted / missing from this CSV". Callers must handle -1.
 */
function pickIndex(header: string[], ...candidates: string[]): number {
  const normalized = header.map((h) => h.trim().toLowerCase());
  for (const cand of candidates) {
    const idx = normalized.indexOf(cand.trim().toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

interface ColumnMap {
  loanNumber: number;
  dateApproved: number;
  borrowerName: number;
  borrowerAddress: number;
  borrowerCity: number;
  borrowerState: number;
  borrowerZip: number;
  naicsCode: number;
  jobsReported: number;
  loanAmount: number;
  loanStatus: number;
  // Optional pre-redaction columns (≥$150k original release):
  ownerFirst: number;
  ownerLast: number;
  ownerAddress: number;
  businessPhone: number;
  email: number;
}

function buildColumnMap(header: string[]): ColumnMap {
  return {
    // Required — current layout.
    loanNumber: pickIndex(header, "LoanNumber", "loan_number"),
    dateApproved: pickIndex(header, "DateApproved", "date_approved"),
    borrowerName: pickIndex(header, "BorrowerName", "borrower_name"),
    borrowerAddress: pickIndex(header, "BorrowerAddress", "borrower_address"),
    borrowerCity: pickIndex(header, "BorrowerCity", "borrower_city"),
    borrowerState: pickIndex(header, "BorrowerState", "borrower_state"),
    borrowerZip: pickIndex(header, "BorrowerZip", "borrower_zip"),
    naicsCode: pickIndex(header, "NAICSCode", "naics_code", "NAICS"),
    jobsReported: pickIndex(header, "JobsReported", "jobs_reported"),
    loanAmount: pickIndex(
      header,
      "CurrentApprovalAmount",
      "current_approval_amount",
      "InitialApprovalAmount",
      "LoanAmount",
      "loan_amount",
    ),
    loanStatus: pickIndex(header, "LoanStatus", "loan_status"),
    // Optional — pre-redaction layout only. -1 when absent; ingestor
    // silently skips those fields for the current combined release.
    ownerFirst: pickIndex(header, "OwnerFirstName", "owner_first", "FirstName"),
    ownerLast: pickIndex(header, "OwnerLastName", "owner_last", "LastName"),
    ownerAddress: pickIndex(header, "OwnerAddress", "owner_address"),
    businessPhone: pickIndex(
      header,
      "BusinessPhone",
      "business_phone",
      "Phone",
    ),
    email: pickIndex(header, "Email", "email"),
  };
}

/* ── Row → DB shape ──────────────────────────────────────────────────── */

function strip5Zip(s: string): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  // SBA occasionally ships a 9-digit zip as "123456789" or "12345-6789".
  const m = t.match(/^(\d{5})/);
  return m ? m[1]! : t.slice(0, 5);
}

function cleanString(s: string | undefined): string | null {
  if (s === undefined) return null;
  const t = s.trim();
  return t ? t : null;
}

function parseInteger(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function parseNumber(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim().replace(/[$,]/g, "");
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function parseDate(s: string | undefined): string | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (!t) return null;
  // SBA ships MM/DD/YYYY most commonly; some releases ship YYYY-MM-DD.
  const slash = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1]}-${slash[2]}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t;
  return null; // unknown format → null rather than letting Postgres reject
}

function normalizeAddress(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

function normalizePhone(s: string | null): string | null {
  if (!s) return null;
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // Whatever the state gave us — store verbatim rather than drop.
  return s.trim();
}

interface PPPRow {
  loan_id: string;
  borrower_name: string;
  borrower_address: string | null;
  borrower_city: string | null;
  borrower_state: string | null;
  borrower_zip: string | null;
  naics_code: string | null;
  owner_first: string | null;
  owner_last: string | null;
  owner_address: string | null;
  business_phone: string | null;
  email: string | null;
  employee_count: number | null;
  loan_amount: number | null;
  forgiveness_status: string | null;
  loan_date: string | null;
}

function pick(cols: string[], idx: number): string | undefined {
  if (idx < 0 || idx >= cols.length) return undefined;
  return cols[idx];
}

function buildRow(cols: string[], map: ColumnMap): PPPRow | null {
  const loanId = cleanString(pick(cols, map.loanNumber));
  const borrowerName = cleanString(pick(cols, map.borrowerName));
  // borrower_name is NOT NULL in the table — drop rows missing it.
  // loan_id is UNIQUE but nullable; still require it so upsert has
  // something to conflict on.
  if (!loanId || !borrowerName) return null;

  const zip = strip5Zip(pick(cols, map.borrowerZip) ?? "");

  return {
    loan_id: loanId,
    borrower_name: borrowerName,
    borrower_address: normalizeAddress(cleanString(pick(cols, map.borrowerAddress))),
    borrower_city: cleanString(pick(cols, map.borrowerCity)),
    borrower_state: cleanString(pick(cols, map.borrowerState))?.toUpperCase() ?? null,
    borrower_zip: zip || null,
    naics_code: cleanString(pick(cols, map.naicsCode)),
    owner_first: cleanString(pick(cols, map.ownerFirst)),
    owner_last: cleanString(pick(cols, map.ownerLast)),
    owner_address: normalizeAddress(cleanString(pick(cols, map.ownerAddress))),
    business_phone: normalizePhone(cleanString(pick(cols, map.businessPhone))),
    email: cleanString(pick(cols, map.email)),
    employee_count: parseInteger(pick(cols, map.jobsReported)),
    loan_amount: parseNumber(pick(cols, map.loanAmount)),
    forgiveness_status: cleanString(pick(cols, map.loanStatus)),
    loan_date: parseDate(pick(cols, map.dateApproved)),
  };
}

/* ── Flush a batch ───────────────────────────────────────────────────── */

async function flush(batch: PPPRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const { error } = await supabase
    .from("ppp_loans")
    .upsert(batch, { onConflict: "loan_id", ignoreDuplicates: false });
  if (error) {
    // Don't throw — log and skip so a single malformed batch doesn't kill a
    // multi-hour run. UPSERT makes a partial re-run safe next time.
    console.error(`  batch flush failed (${batch.length} rows): ${error.message}`);
    return 0;
  }
  return batch.length;
}

/* ── Main ────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const state = loadState();
  const t0 = Date.now();
  console.log(
    `Ingesting ${FILE_PATH} → ppp_loans  batch=${BATCH}  max=${MAX === Number.POSITIVE_INFINITY ? "∞" : MAX}`,
  );
  if (state.line_offset > 0) {
    console.log(`  resuming at line ${state.line_offset.toLocaleString()}`);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(FILE_PATH!, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let headerParsed = false;
  let colMap: ColumnMap | null = null;
  let batch: PPPRow[] = [];
  let lastLogged = 0;

  for await (const line of rl) {
    lineNo++;

    // Parse the header once. Always parse on line 1 — even on resume,
    // we need the column map in memory before we start rebuilding rows.
    if (!headerParsed) {
      const header = parseCsvLine(line);
      colMap = buildColumnMap(header);
      headerParsed = true;

      // Quick sanity check — if the required columns are missing, bail
      // loud rather than silently ingesting empty rows.
      const required: Array<[string, number]> = [
        ["LoanNumber", colMap.loanNumber],
        ["BorrowerName", colMap.borrowerName],
      ];
      const missing = required.filter(([, idx]) => idx === -1).map(([name]) => name);
      if (missing.length > 0) {
        console.error(
          `Header missing required column(s): ${missing.join(", ")}\n` +
            `Saw: ${header.slice(0, 10).join(", ")}${header.length > 10 ? " …" : ""}`,
        );
        process.exit(2);
      }

      // Log which optional pre-redaction columns are present, so the
      // operator knows whether this file carries owner/phone data.
      const optional = {
        OwnerFirst: colMap.ownerFirst !== -1,
        OwnerLast: colMap.ownerLast !== -1,
        OwnerAddress: colMap.ownerAddress !== -1,
        BusinessPhone: colMap.businessPhone !== -1,
        Email: colMap.email !== -1,
      };
      console.log(
        `  header parsed: ${header.length} cols; owner/phone present: ${JSON.stringify(optional)}`,
      );
      continue;
    }

    if (lineNo <= state.line_offset) continue;
    if (state.scanned >= MAX) break;

    state.scanned++;
    const cols = parseCsvLine(line);
    const row = buildRow(cols, colMap!);
    if (row) batch.push(row);

    if (batch.length >= BATCH) {
      const ok = await flush(batch);
      state.inserted += ok;
      state.line_offset = lineNo;
      saveState(state);
      batch = [];
    }

    if (state.scanned - lastLogged >= 10_000) {
      lastLogged = state.scanned;
      const sec = Math.round((Date.now() - t0) / 1000);
      console.log(
        `  scanned=${state.scanned.toLocaleString()}  inserted=${state.inserted.toLocaleString()}  (${sec}s)`,
      );
    }
  }

  // Tail flush.
  if (batch.length > 0) {
    const ok = await flush(batch);
    state.inserted += ok;
    state.line_offset = lineNo;
    saveState(state);
  }

  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(
    `Done. scanned=${state.scanned.toLocaleString()}  inserted=${state.inserted.toLocaleString()}  in ${sec}s`,
  );
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
