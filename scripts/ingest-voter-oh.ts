#!/usr/bin/env npx tsx
/**
 * Ingest the Ohio statewide voter extract into `voter_oh`.
 * ─────────────────────────────────────────────────────────────────────────────
 * Source:
 *   https://www6.ohiosos.gov/ords/f?p=111:1
 *   Download the statewide file (SWVF_*.csv) OR any of the 4 regional
 *   extracts (SWVF_1_22.csv, SWVF_23_44.csv, etc). The regional splits
 *   have identical column layouts, so this script accepts either. Ohio
 *   publishes ~8M voter records statewide. File is comma-delimited CSV
 *   with a header row.
 *
 * Column layout (verified on 2024-10 download snapshot). Columns we care
 * about, by name:
 *
 *   SOS_VOTERID, COUNTY_NUMBER, COUNTY_ID, LAST_NAME, FIRST_NAME,
 *   MIDDLE_NAME, SUFFIX, DATE_OF_BIRTH, REGISTRATION_DATE, VOTER_STATUS,
 *   PARTY_AFFILIATION, RESIDENTIAL_ADDRESS1, RESIDENTIAL_SECONDARY_ADDRESS,
 *   RESIDENTIAL_CITY, RESIDENTIAL_STATE, RESIDENTIAL_ZIP,
 *   RESIDENTIAL_ZIP_PLUS4, RESIDENTIAL_COUNTRY, RESIDENTIAL_POSTALCODE,
 *   MAILING_ADDRESS1, MAILING_SECONDARY_ADDRESS, MAILING_CITY,
 *   MAILING_STATE, MAILING_ZIP, MAILING_ZIP_PLUS4, ...and per-election
 *   vote-history columns we ignore.
 *
 * OH does NOT publish phone or email. We still ingest the record so the
 * lookup module can surface the owner_name/mailing address — useful for
 * direct-mail follow-up when the phone path is empty.
 *
 * Usage:
 *   npx tsx scripts/ingest-voter-oh.ts /path/to/SWVF_1_22.csv
 *   MAX=100000 npx tsx scripts/ingest-voter-oh.ts /path/to/SWVF_1_22.csv
 *   BATCH=5000 npx tsx scripts/ingest-voter-oh.ts /path/to/SWVF_1_22.csv
 *
 * Streams the file via readline. Upserts in batches of 5000 via
 * .upsert({ onConflict: "voter_id" }). Resumable via
 * scripts/.ingest-voter-oh.state.json. Supports multiple regional files
 * sequentially — just re-run with a different path; each file gets its
 * own state entry keyed on file_path.
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
  ".ingest-voter-oh.state.json",
);

const DOWNLOAD_INSTRUCTIONS = `
  OH voter file not found.

  Download steps:
    1. Visit https://www6.ohiosos.gov/ords/f?p=111:1
    2. Pick the statewide file OR any regional SWVF_*.csv extract.
    3. Download to a local path (CSV, comma-delimited, header row).

  Then re-run:
    npx tsx scripts/ingest-voter-oh.ts /path/to/SWVF_1_22.csv
`;

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/ingest-voter-oh.ts /path/to/SWVF_file.csv",
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

/* ── State ───────────────────────────────────────────────────────────── */

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

/* ── CSV parser (same as NC — small, copied to keep scripts independent) ── */

function parseCsv(line: string): string[] {
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

/* ── Normalization ───────────────────────────────────────────────────── */

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
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t;
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return t;
}

interface VoterOHRow {
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
): VoterOHRow | null {
  const pick = (name: string): string => {
    const idx = colIdx[name];
    if (idx === undefined) return "";
    return (cols[idx] ?? "").trim();
  };

  const voterId = pick("sos_voterid");
  if (!voterId) return null;

  const addr1 = pick("residential_address1");
  const addr2 = pick("residential_secondary_address");
  const fullAddr = normalizeAddress([addr1, addr2].filter(Boolean).join(" "));
  const zip = strip5Zip(pick("residential_zip"));
  if (!fullAddr || !zip) return null;

  return {
    voter_id: voterId,
    first_name: pick("first_name") || null,
    middle_name: pick("middle_name") || null,
    last_name: pick("last_name") || null,
    name_suffix: pick("suffix") || null,
    residence_address: fullAddr,
    residence_city: pick("residential_city") || null,
    residence_zip: zip,
    county: pick("county_id") || pick("county_number") || null,
    phone: null, // OH does not publish phone
    email: null, // OH does not publish email
    registration_date: parseDate(pick("registration_date")),
    party: pick("party_affiliation") || null,
  };
}

/* ── Flush ───────────────────────────────────────────────────────────── */

async function flush(batch: VoterOHRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const { error } = await supabase
    .from("voter_oh")
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
    `Ingesting ${FILE_PATH} → voter_oh  batch=${BATCH}  max=${MAX === Number.POSITIVE_INFINITY ? "∞" : MAX}`,
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
  let batch: VoterOHRow[] = [];
  let lastLogged = 0;

  for await (const line of rl) {
    lineNo++;
    if (colIdx === null) {
      const headers = parseCsv(line).map((h) => h.trim().toLowerCase());
      colIdx = {};
      headers.forEach((h, i) => {
        colIdx![h] = i;
      });
      if (!("sos_voterid" in colIdx)) {
        console.error(
          `  header missing expected 'sos_voterid' — got: ${headers.slice(0, 10).join(", ")}...`,
        );
        process.exit(1);
      }
      continue;
    }

    if (lineNo <= state.line_offset) continue;
    if (state.scanned >= MAX) break;

    state.scanned++;
    const cols = parseCsv(line);
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
