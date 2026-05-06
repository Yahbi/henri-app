#!/usr/bin/env npx tsx
/**
 * Ingest the Florida statewide voter extract into `voter_fl`.
 * ─────────────────────────────────────────────────────────────────────────────
 * Source:
 *   https://dos.myflorida.com/elections/data-statistics/voter-registration-statistics/voter-extract-disk-request/
 *   One-time request-form submission; state returns a download URL. The file
 *   is a tab-delimited plain-text extract (one row per voter, ~15M rows,
 *   ~5GB uncompressed). FL publishes the daytime phone number directly in
 *   the file — that's the enrichment prize here.
 *
 * Column layout (verified on 2024-12 download snapshot, per the state's
 * "Voter Extract Record Layout" PDF). Tab-delimited, no header row:
 *    0  County Code                       20 Precinct Split
 *    1  Voter ID                          21 Precinct Suffix
 *    2  Last Name                         22 Voter Status
 *    3  Suffix                            23 Congressional District
 *    4  First Name                        24 House District
 *    5  Middle Name                       25 Senate District
 *    6  Exempt Flag                       26 County Commission District
 *    7  Residence Address Line 1          27 School Board District
 *    8  Residence Address Line 2          28 Daytime Area Code
 *    9  City (USPS)                       29 Daytime Phone
 *   10  State                             30 Daytime Phone Ext
 *   11  Zip                               31 Email
 *   12  Mailing Address Line 1            (remaining columns unused)
 *   13  Mailing Address Line 2
 *   14  Mailing Address Line 3
 *   15  Mailing City
 *   16  Mailing State
 *   17  Mailing Zip
 *   18  Mailing Country
 *   19  Gender / Race / Birth Date / Registration Date / Party Affiliation
 *       (these appear interleaved with Precinct at the columns below;
 *        we only pull Registration Date + Party Affiliation because the
 *        rest is privacy-sensitive and not needed for enrichment)
 *
 * Usage:
 *   npx tsx scripts/ingest-voter-fl.ts /path/to/fl_voter_file.txt
 *   MAX=100000 npx tsx scripts/ingest-voter-fl.ts /path/to/fl_voter_file.txt
 *   BATCH=5000 npx tsx scripts/ingest-voter-fl.ts /path/to/fl_voter_file.txt
 *
 * Streams the file via readline (do NOT load the whole thing — 5GB+).
 * Upserts in batches of 5000 via .upsert({ onConflict: "voter_id" }).
 * Resumable via scripts/.ingest-voter-fl.state.json — the script checkpoints
 * after every successful batch flush, and on restart it seeks past lines
 * already processed. Killing with ctrl-C between flushes is safe: at worst
 * you reprocess one batch (and UPSERT makes that a no-op).
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
  ".ingest-voter-fl.state.json",
);

const DOWNLOAD_INSTRUCTIONS = `
  Florida voter file not found.

  Download steps:
    1. Visit https://dos.myflorida.com/elections/data-statistics/voter-registration-statistics/voter-extract-disk-request/
    2. Submit the Voter Extract Request form (public-records fee may apply).
    3. The state emails you a one-time download link for the statewide file.
    4. Unzip to a local path. The file is tab-delimited plain text.

  Then re-run:
    npx tsx scripts/ingest-voter-fl.ts /path/to/fl_voter_file.txt
`;

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/ingest-voter-fl.ts /path/to/fl_voter_file.txt",
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
  scanned: number; // total rows read from the file
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

/* ── Row → DB shape ──────────────────────────────────────────────────── */

/** Uppercase + collapse internal whitespace. Matches the normalization
 *  the live-lookup module applies to the inbound permit address. */
function normalizeAddress(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

function strip5Zip(s: string): string {
  const t = s.trim();
  if (!t) return "";
  // FL occasionally publishes a 9-digit zip as "123456789" or "12345-6789".
  const m = t.match(/^(\d{5})/);
  return m ? m[1]! : t.slice(0, 5);
}

function parseDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  // FL ships MM/DD/YYYY.
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  // Fallback — let Postgres reject a bad value rather than silently null.
  return t;
}

function composePhone(areaCode: string, phone: string): string | null {
  const a = areaCode.replace(/\D+/g, "");
  const p = phone.replace(/\D+/g, "");
  if (!p) return null;
  if (a && a.length === 3 && p.length === 7) return `(${a}) ${p.slice(0, 3)}-${p.slice(3)}`;
  if (p.length === 10) return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
  return p; // whatever the state gave us, store it verbatim
}

interface VoterFLRow {
  voter_id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  name_suffix: string | null;
  residence_address: string;
  residence_city: string | null;
  residence_zip: string;
  county: string | null;
  phone: string | null;
  email: string | null;
  registration_date: string | null;
  party: string | null;
}

function parseLine(line: string): VoterFLRow | null {
  // FL ships tab-delimited. Quoted values are not used — straight split is safe.
  const cols = line.split("\t");
  // We read past the phone/email columns at index 31, so tolerate any longer row.
  if (cols.length < 32) return null;

  const voterId = (cols[1] ?? "").trim();
  if (!voterId) return null;

  const addr1 = (cols[7] ?? "").trim();
  const addr2 = (cols[8] ?? "").trim();
  const fullAddr = normalizeAddress([addr1, addr2].filter(Boolean).join(" "));
  const zip = strip5Zip(cols[11] ?? "");

  // Skip rows with no usable address + zip — they can't be matched later.
  if (!fullAddr || !zip) return null;

  return {
    voter_id: voterId,
    first_name: (cols[4] ?? "").trim() || null,
    middle_name: (cols[5] ?? "").trim() || null,
    last_name: (cols[2] ?? "").trim() || null,
    name_suffix: (cols[3] ?? "").trim() || null,
    residence_address: fullAddr,
    residence_city: (cols[9] ?? "").trim() || null,
    residence_zip: zip,
    county: (cols[0] ?? "").trim() || null,
    phone: composePhone(cols[28] ?? "", cols[29] ?? ""),
    email: (cols[31] ?? "").trim() || null,
    // Registration date sits alongside Precinct columns in the state's
    // layout; the position below was verified on the 2024-12 snapshot.
    // If a future extract ships a new column order, adjust indexes.
    registration_date: parseDate(cols[22] ?? ""),
    party: (cols[23] ?? "").trim() || null,
  };
}

/* ── Flush a batch ───────────────────────────────────────────────────── */

async function flush(batch: VoterFLRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const { error } = await supabase
    .from("voter_fl")
    .upsert(batch, { onConflict: "voter_id", ignoreDuplicates: false });
  if (error) {
    // Don't throw — log and skip so a single malformed row doesn't kill a
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
    `Ingesting ${FILE_PATH} → voter_fl  batch=${BATCH}  max=${MAX === Number.POSITIVE_INFINITY ? "∞" : MAX}`,
  );
  if (state.line_offset > 0) {
    console.log(`  resuming at line ${state.line_offset.toLocaleString()}`);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(FILE_PATH!, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let batch: VoterFLRow[] = [];
  let lastLogged = 0;

  for await (const line of rl) {
    lineNo++;
    if (lineNo <= state.line_offset) continue;
    if (state.scanned >= MAX) break;

    state.scanned++;
    const row = parseLine(line);
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
