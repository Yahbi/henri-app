#!/usr/bin/env npx tsx
/**
 * Ingest the North Carolina statewide voter extract into `voter_nc`.
 * ─────────────────────────────────────────────────────────────────────────────
 * Source:
 *   https://www.ncsbe.gov/results-data/voter-registration-data
 *   Download `ncvoter_Statewide.zip` (free, no request form). Unzip it to
 *   get `ncvoter_Statewide.txt` (despite the `.txt` suffix, it's a
 *   tab-delimited file with a header row). NC publishes ~8M voter records
 *   statewide.
 *
 * Column layout (verified on 2024-11 download snapshot). Tab-delimited,
 * first line is the header. Columns we care about, by name:
 *
 *   county_id, county_desc, voter_reg_num, ncid, last_name, first_name,
 *   middle_name, name_suffix_lbl, status_cd, voter_status_desc, reason_cd,
 *   voter_status_reason_desc, res_street_address, res_city_desc, state_cd,
 *   zip_code, mail_addr1, mail_addr2, mail_addr3, mail_addr4, mail_city,
 *   mail_state, mail_zipcode, full_phone_number (rare/null), race_code,
 *   ethnic_code, party_cd, gender_code, birth_year, age_at_year_end,
 *   birth_state, drivers_lic, registr_dt, precinct_abbrv, precinct_desc,
 *   ...and more.
 *
 * We look up each column by header name rather than fixed index, so minor
 * column-order changes between snapshots are tolerated. Only a missing
 * required column (voter id / residence address / zip) rejects the row.
 *
 * Usage:
 *   npx tsx scripts/ingest-voter-nc.ts /path/to/ncvoter_Statewide.txt
 *   MAX=100000 npx tsx scripts/ingest-voter-nc.ts /path/to/ncvoter_Statewide.txt
 *   BATCH=5000 npx tsx scripts/ingest-voter-nc.ts /path/to/ncvoter_Statewide.txt
 *
 * Streams the file via readline. Upserts in batches of 5000 via
 * .upsert({ onConflict: "voter_id" }). Resumable via
 * scripts/.ingest-voter-nc.state.json.
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
  ".ingest-voter-nc.state.json",
);

const DOWNLOAD_INSTRUCTIONS = `
  NC voter file not found.

  Download steps:
    1. Visit https://www.ncsbe.gov/results-data/voter-registration-data
    2. Download ncvoter_Statewide.zip (free, no form).
    3. Unzip to get ncvoter_Statewide.txt (tab-delimited despite the .txt suffix).

  Then re-run:
    npx tsx scripts/ingest-voter-nc.ts /path/to/ncvoter_Statewide.txt
`;

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/ingest-voter-nc.ts /path/to/ncvoter_Statewide.txt",
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

/* ── State file ──────────────────────────────────────────────────────── */

interface IngestState {
  file_path: string;
  line_offset: number;
  inserted: number;
  scanned: number;
  started_at: string;
}

function loadState(): IngestState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as IngestState;
      if (parsed.file_path === FILE_PATH) return parsed;
    }
  } catch {
    /* fall through */
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

/* ── Tiny streaming CSV/TSV row parser ───────────────────────────────── */

/** Parse one delimited row honoring double-quote escaping. NC's extract
 *  quotes fields that contain the delimiter or embedded quotes. */
function parseDelimited(line: string, delim: string): string[] {
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
      } else if (ch === delim) {
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

/* ── Normalization + row build ───────────────────────────────────────── */

function normalizeAddress(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

function strip5Zip(s: string): string {
  const t = s.trim();
  if (!t) return "";
  const m = t.match(/^(\d{5})/);
  return m ? m[1]! : t.slice(0, 5);
}

function parseDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  // NC ships YYYY-MM-DD already.
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t;
  // Fallback: MM/DD/YYYY seen in older snapshots.
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return t;
}

function cleanPhone(s: string): string | null {
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

interface VoterNCRow {
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

function buildRow(
  cols: string[],
  colIdx: Record<string, number>,
): VoterNCRow | null {
  const pick = (name: string): string => {
    const idx = colIdx[name];
    if (idx === undefined) return "";
    return (cols[idx] ?? "").trim();
  };

  // NC's stable id — prefer ncid (statewide unique), fall back to voter_reg_num.
  const voterId = pick("ncid") || pick("voter_reg_num");
  if (!voterId) return null;

  const addr = normalizeAddress(pick("res_street_address"));
  const zip = strip5Zip(pick("zip_code"));
  if (!addr || !zip) return null;

  return {
    voter_id: voterId,
    first_name: pick("first_name") || null,
    middle_name: pick("middle_name") || null,
    last_name: pick("last_name") || null,
    name_suffix: pick("name_suffix_lbl") || null,
    residence_address: addr,
    residence_city: pick("res_city_desc") || null,
    residence_zip: zip,
    county: pick("county_desc") || null,
    phone: cleanPhone(pick("full_phone_number")),
    email: null, // NC does not publish email
    registration_date: parseDate(pick("registr_dt")),
    party: pick("party_cd") || null,
  };
}

/* ── Flush ───────────────────────────────────────────────────────────── */

async function flush(batch: VoterNCRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const { error } = await supabase
    .from("voter_nc")
    .upsert(batch, { onConflict: "voter_id", ignoreDuplicates: false });
  if (error) {
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
    `Ingesting ${FILE_PATH} → voter_nc  batch=${BATCH}  max=${MAX === Number.POSITIVE_INFINITY ? "∞" : MAX}`,
  );
  if (state.line_offset > 0) {
    console.log(`  resuming at line ${state.line_offset.toLocaleString()}`);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(FILE_PATH!, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let colIdx: Record<string, number> | null = null;
  let batch: VoterNCRow[] = [];
  let lastLogged = 0;
  // NC's published file is tab-delimited despite the "csv" naming in the
  // ncsbe docs. Detect the actual delimiter from the header.
  let delim: string = "\t";

  for await (const line of rl) {
    lineNo++;
    // Header row handling — always parse even on resume, so we know columns.
    if (colIdx === null) {
      delim = line.includes("\t") ? "\t" : ",";
      const headers = parseDelimited(line, delim).map((h) => h.trim().toLowerCase());
      colIdx = {};
      headers.forEach((h, i) => {
        colIdx![h] = i;
      });
      if (!("ncid" in colIdx) && !("voter_reg_num" in colIdx)) {
        console.error(
          `  header missing expected 'ncid' / 'voter_reg_num' — got: ${headers.slice(0, 10).join(", ")}...`,
        );
        process.exit(1);
      }
      continue;
    }

    if (lineNo <= state.line_offset) continue;
    if (state.scanned >= MAX) break;

    state.scanned++;
    const cols = parseDelimited(line, delim);
    const row = buildRow(cols, colIdx);
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
