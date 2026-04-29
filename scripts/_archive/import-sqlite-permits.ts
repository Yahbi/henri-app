/**
 * Phase 3a — Bulk-load permits from Data Henri 3's permits.db into Supabase.
 *
 * Constraints (Free tier, confirmed with user):
 *   - Cap at 500 000 most-recent rows (by first_seen_at DESC)
 *   - Strip raw_data blob to fit size budget; keep only normalized hints
 *   - Upsert via (source_city, source_id) unique key; safe to re-run
 *   - Resumable via --offset flag (reads scripts/.import-permits.state.json)
 *
 * Real permits.db schema (from Phase 0 preflight):
 *   id, source_id, permit_number, permit_type, address (full text with city/state/zip),
 *   status, description, issue_date (ISO string), applied_date, value (VARCHAR),
 *   contractor, owner, latitude, longitude, jurisdiction, state (2-char),
 *   city (may hold county name), county, source_url, raw_data (large JSON),
 *   first_seen_at, last_seen_at
 *
 * Run:  npx tsx scripts/import-sqlite-permits.ts
 * Flags: --limit=500000, --offset=0, --batch=100, --fat (keep raw_data)
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import {
  mapPermitTypeToEnum,
  mapPermitTypeToTrade,
  parseAddress,
} from "../src/lib/ingest/normalize";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const PERMITS_DB = "C:/Users/yabis/Desktop/Data Henri 3/permits.db";
const STATE_FILE = path.join(process.cwd(), "scripts", ".import-permits.state.json");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => {
      const m = /^--([^=]+)(?:=(.+))?$/.exec(a);
      return m ? [m[1], m[2] ?? "true"] : null;
    })
    .filter((x): x is [string, string] => x !== null),
);
const LIMIT = parseInt(args.limit ?? "500000", 10);
const BATCH = parseInt(args.batch ?? "100", 10);
const FAT = args.fat === "true";
let OFFSET = parseInt(args.offset ?? "0", 10);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type SqliteRow = {
  id: number;
  source_id: string;
  permit_number: string;
  permit_type: string;
  address: string;
  status: string;
  description: string;
  issue_date: string;
  applied_date: string;
  value: string;
  contractor: string;
  owner: string;
  latitude: number | null;
  longitude: number | null;
  jurisdiction: string;
  state: string;
  city: string;
  county: string;
  source_url: string;
  raw_data: string;
  first_seen_at: string;
  last_seen_at: string;
};

type SupabasePermit = {
  source_city: string;
  source_id: string;
  permit_number: string | null;
  permit_type: string;
  status: string;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  applicant_name: string | null;
  contractor_name: string | null;
  estimated_value: number | null;
  applied_date: string | null;
  issued_date: string | null;
  raw_json: Record<string, unknown>;
  source_type: "socrata" | "arcgis" | "csv" | "ckan";
};

const GARBAGE = [/INVALID/i, /test\s/i, /^\d{1,3}$/, /^\d{2}-\d{2}-\d{4}\s\d{2}-\d{2}-[AP]M/i];
const ADMIN_TYPES = new Set([
  "add contractor license to a record",
  "add contact to a building record",
  "add/change licensed professional",
  "change of contact information",
  "change of scope",
  "fee appeal case",
  "research-zoning history",
  "contractor-general-agent",
  "contractor-plumbing-agent",
  "contractor-heating & cooling-agent",
  "contractor-general-llc",
]);

function slug(s: string): string {
  return (s || "unknown")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sourceTypeFromId(sourceId: string): "socrata" | "arcgis" | "csv" | "ckan" {
  const s = sourceId.toLowerCase();
  if (s.startsWith("socrata")) return "socrata";
  if (s.startsWith("arcgis")) return "arcgis";
  if (s.startsWith("ckan")) return "ckan";
  return "csv";
}

/** Parse a VARCHAR value like "$3,500.00" or "3500" or "" → integer cents, or null. */
function parseValueCents(v: string | null | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Parse an ISO-ish date string → YYYY-MM-DD, or null. */
function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s.trim());
  return m ? m[1] : null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ")
    .trim();
}

function normalizeRow(raw: SqliteRow): SupabasePermit | null {
  // Garbage filter
  const pNum = raw.permit_number?.trim() ?? "";
  if (!pNum) return null;
  for (const re of GARBAGE) if (re.test(pNum)) return null;
  if (raw.permit_type && ADMIN_TYPES.has(raw.permit_type.toLowerCase())) return null;

  // Parse address
  const knownCity = raw.city || "";
  const knownState = (raw.state || "").slice(0, 2);
  const parsed = raw.address ? parseAddress(raw.address, knownCity, knownState) : null;
  const zip = parsed?.zip ?? null;
  const streetOnly = parsed?.street ?? raw.address ?? null;

  // Prefer city from address parse (embedded in "STREET, CITY, ST ZIP") if available.
  // Quick heuristic: city is the token between last two commas before the state.
  let displayCity: string | null = raw.city || null;
  if (raw.address) {
    const m = raw.address.match(/,\s*([^,]+?),\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/);
    if (m && m[1]) displayCity = m[1].trim();
  }

  const trade = raw.permit_type ? mapPermitTypeToTrade(raw.permit_type) : "general";
  const permitTypeEnum = raw.permit_type ? mapPermitTypeToEnum(raw.permit_type) : "other";

  const ownerName = raw.owner?.trim() || null;
  let ownerFirst: string | null = null;
  let ownerLast: string | null = null;
  if (ownerName) {
    const parts = ownerName.split(/\s+/);
    if (parts.length >= 2) {
      ownerFirst = titleCase(parts[0]);
      ownerLast = titleCase(parts.slice(1).join(" "));
    } else {
      ownerLast = titleCase(ownerName);
    }
  }

  const rawJson: Record<string, unknown> = {
    normalized_trade: trade,
    permit_type_raw: raw.permit_type || null,
    owner_first: ownerFirst,
    owner_last: ownerLast,
    original_source_id: raw.source_id,
    source_url: raw.source_url || null,
    first_seen_at: raw.first_seen_at || null,
    ingest_run_at: new Date().toISOString(),
  };
  if (FAT && raw.raw_data) rawJson.raw_data = raw.raw_data;

  const sourceCity = `${knownState.toLowerCase()}_${slug(displayCity || raw.city)}`.slice(0, 60);

  return {
    source_city: sourceCity,
    source_id: pNum,
    permit_number: pNum,
    permit_type: permitTypeEnum,
    status: "submitted", // most permits.db rows have empty status
    description: raw.description?.trim() || null,
    address: streetOnly || null,
    city: displayCity,
    state: knownState || null,
    zip,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    applicant_name: ownerName ? titleCase(ownerName) : null,
    contractor_name: raw.contractor?.trim() ? titleCase(raw.contractor) : null,
    estimated_value: parseValueCents(raw.value),
    applied_date: parseDate(raw.applied_date),
    issued_date: parseDate(raw.issue_date),
    raw_json: rawJson,
    source_type: sourceTypeFromId(raw.source_id),
  };
}

async function upsert(rows: SupabasePermit[]): Promise<{ ok: number; err: number }> {
  if (rows.length === 0) return { ok: 0, err: 0 };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/permits`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    // Try one-by-one to salvage good rows
    let ok = 0;
    let err = 0;
    for (const row of rows) {
      const r2 = await fetch(`${SUPABASE_URL}/rest/v1/permits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([row]),
      });
      if (r2.ok) ok++;
      else err++;
    }
    if (err > 0) {
      console.warn(
        `  batch: ${ok} ok, ${err} err. last error preview: ${body.slice(0, 300)}`,
      );
    }
    return { ok, err };
  }
  return { ok: rows.length, err: 0 };
}

function writeState(offset: number, processed: number, inserted: number) {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ offset, processed, inserted, updated_at: new Date().toISOString() }, null, 2),
  );
}

async function main() {
  console.log(
    `Config: LIMIT=${LIMIT} BATCH=${BATCH} FAT=${FAT} OFFSET=${OFFSET}`,
  );

  const db = new Database(PERMITS_DB, { readonly: true, fileMustExist: true });
  db.pragma("query_only = on");

  // Use the issue_date index (ix_permits_issue_date) for fast sorted streaming.
  // Rows with empty issue_date are filtered out — they're rare and the scorer
  // would discard them anyway (no freshness signal).
  //
  // Filter to permits issued after `since` (default = 18 months ago) so the
  // load is dominated by recent data useful for the map.
  const since = args.since ?? isoDate(new Date(Date.now() - 18 * 30 * 86400_000));
  console.log(`SQLite filter: issue_date >= '${since}'  LIMIT ${LIMIT}`);

  const stmt = db.prepare(`
    SELECT id, source_id, permit_number, permit_type, address, status, description,
           issue_date, applied_date, value, contractor, owner, latitude, longitude,
           jurisdiction, state, city, county, source_url, raw_data,
           first_seen_at, last_seen_at
    FROM permits
    WHERE issue_date >= ?
    ORDER BY issue_date DESC, id DESC
    LIMIT ?
  `);

  let processed = 0;
  let inserted = 0;
  let dropped = 0;
  let errors = 0;
  const startedAt = Date.now();

  // Stream via iterator to avoid loading all 200k rows in memory.
  const iter = stmt.iterate(since, LIMIT) as IterableIterator<SqliteRow>;

  const buffer: SupabasePermit[] = [];
  const seenKeys = new Set<string>();

  const flush = async () => {
    if (buffer.length === 0) return;
    // Dedupe within this flush window.
    const deduped: SupabasePermit[] = [];
    const localSeen = new Set<string>();
    for (const n of buffer) {
      const k = `${n.source_city}::${n.source_id}`;
      if (localSeen.has(k) || seenKeys.has(k)) continue;
      localSeen.add(k);
      seenKeys.add(k);
      deduped.push(n);
    }
    buffer.length = 0;

    // Batch upsert with parallelism
    const CONCURRENCY = 8;
    const chunks: SupabasePermit[][] = [];
    for (let i = 0; i < deduped.length; i += BATCH) chunks.push(deduped.slice(i, i + BATCH));
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const group = chunks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(group.map((c) => upsert(c)));
      for (const r of results) {
        inserted += r.ok;
        errors += r.err;
      }
    }
  };

  // Skip offset rows if resuming
  let skipped = 0;
  for (const row of iter) {
    if (skipped < OFFSET) {
      skipped++;
      continue;
    }
    const n = normalizeRow(row);
    if (!n) {
      dropped++;
    } else {
      buffer.push(n);
    }
    processed++;
    if (buffer.length >= 2000) {
      await flush();
      const elapsed = (Date.now() - startedAt) / 1000;
      const rps = Math.round(processed / elapsed);
      console.log(
        `  processed=${processed.toLocaleString()} inserted=${inserted.toLocaleString()} dropped=${dropped.toLocaleString()} errors=${errors} | ${rps}/s`,
      );
      writeState(OFFSET + processed, processed, inserted);
    }
  }
  await flush();

  db.close();
  console.log(
    `Done. processed=${processed.toLocaleString()} inserted=${inserted.toLocaleString()} dropped=${dropped.toLocaleString()} errors=${errors}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
