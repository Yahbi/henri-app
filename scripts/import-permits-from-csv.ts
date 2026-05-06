/**
 * Import actual permit RECORDS (not source URLs) from
 * `C:/Users/yabis/Desktop/henri data/all_permits_leads.csv`
 * (~91MB, 52,371 rows).
 *
 * Schema matches the `permits` table:
 *   id, permit_id, address, city, state, zip_code, latitude, longitude,
 *   permit_type, status, issue_date, estimated_value, contractor,
 *   description, source, raw_data, fetched_at
 *
 * Why this exists separately from `import-permit-archive.ts`:
 *   That script reads gzip'd CSV blobs from a different layout. This
 *   one reads the flat ALL-permits export the user dropped on Apr 15.
 *   Same target table, different upstream shape.
 *
 * Idempotent. Source-key dedup is the canonical permit fingerprint:
 *   `lower(trim(permit_id))::text + '|' + lower(trim(city))::text`
 * matches `permits.dedup_key` (migration 00012).
 *
 * Filter rules:
 *   - Skip rows where `address` is empty (un-routable)
 *   - Apply foreign-domain check on `source` field — defensive
 *   - Defer permit_type → enum mapping to the existing `mapPermitType`
 *     pattern from `src/app/api/cron/score/helpers.ts`
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const s = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

const CSV_CANDIDATES = [
  "C:/Users/yabis/Desktop/henri data/all_permits_leads.csv",
  "C:/Users/yabis/Desktop/all_permits_leads.csv",
];
const CSV_PATH = CSV_CANDIDATES.find((p) => fs.existsSync(p)) ?? CSV_CANDIDATES[0];

const HARD_LIMIT = Number(process.env.IMPORT_LIMIT ?? 0);
const STATE_PATH = path.resolve(
  process.cwd(),
  "scripts",
  ".import-permits-from-csv.state.json",
);

/* ── CSV parser (quote-aware, handles embedded JSON in raw_data) ──── */

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"' && raw[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && raw[i + 1] === "\n") i++;
        row.push(cur);
        if (row.some((v) => v.length > 0)) rows.push(row);
        row = [];
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (row.some((v) => v.length > 0)) rows.push(row);
  }
  return rows;
}

/* ── permit_type enum mapping ────────────────────────────────────── */

function mapPermitType(text: string | null): string {
  if (!text) return "other";
  const lower = text.toLowerCase();
  for (const k of [
    "residential", "commercial", "demolition", "renovation",
    "new_construction", "addition", "repair",
  ]) {
    if (lower.includes(k.replace("_", " ")) || lower.includes(k)) return k;
  }
  if (lower.includes("remodel") || lower.includes("alteration")) return "renovation";
  if (lower.includes("new ") || lower.includes("construct")) return "new_construction";
  if (lower.includes("demo")) return "demolition";
  if (lower.includes("add")) return "addition";
  return "other";
}

/* ── status normalizer (matches src/lib/scrapers/normalizer.ts) ──── */

function normalizeStatus(s: string | null): string {
  const v = (s ?? "").toLowerCase().trim();
  if (!v || v === "unknown") return "submitted";
  if (v.includes("issued")) return "issued";
  if (v.includes("approved") || v.includes("active")) return "issued";
  if (v.includes("complet") || v.includes("closed") || v.includes("final")) return "completed";
  if (v.includes("expired") || v.includes("revoked") || v.includes("cancel")) return "cancelled";
  if (v.includes("pending") || v.includes("review") || v.includes("submit")) return "submitted";
  return "submitted";
}

/* ── ZIP normalize ───────────────────────────────────────────────── */

function normZip(z: string | null): string | null {
  if (!z) return null;
  const m = z.match(/^\d{5}/);
  return m ? m[0] : null;
}

/* ── Numeric parsers ─────────────────────────────────────────────── */

function parseNum(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseLatLng(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

/* ── Date normalizer (handles MM/DD/YYYY, ISO, etc.) ─────────────── */

function normDate(v: string | null): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return null;
}

/* ── Permit row builder ─────────────────────────────────────────── */

/* Schema match for `permits` (migration 00004):
 *   - dedup key: (source_city, source_id)
 *   - source_city: e.g. "New York" — extracted from upstream `source` like "socrata:New York"
 *   - source_id: the upstream stable id (the CSV's `permit_id` column)
 *   - status enum: submitted | approved | issued | final | expired | revoked
 *   - permit_type enum: residential | commercial | demolition | renovation | new_construction | addition | repair | other
 */

interface PermitInsert {
  source_city: string;
  source_id: string;
  permit_number: string | null;
  permit_type: string;
  status: string;
  description: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  applicant_name: string | null;
  contractor_name: string | null;
  estimated_value: number | null;
  applied_date: string | null;
  issued_date: string | null;
  raw_json: Record<string, unknown> | null;
}

/* Coerce status to the enum values from migration 00004. The earlier
 * `normalizeStatus` returned values like "submitted" / "issued" /
 * "completed" / "cancelled" — but the table's `permit_status` enum
 * doesn't include "completed" or "cancelled". Map them to the closest
 * enum member: "completed"→"final", "cancelled"→"revoked". */
function statusForEnum(s: string): string {
  switch (s) {
    case "completed":
      return "final";
    case "cancelled":
      return "revoked";
    default:
      return s;
  }
}

function rowToPermit(row: Record<string, string>): PermitInsert | null {
  const address = (row.address || "").trim();
  if (!address) return null;
  const sourceId = (row.permit_id || row.id || "").trim();
  if (!sourceId) return null; // dedup needs a stable id

  // Defensive foreign-domain check on the source field
  const sourceRaw = (row.source || "").toLowerCase();
  if (
    sourceRaw.includes(".gov.co") ||
    sourceRaw.includes(".gob.mx") ||
    sourceRaw.includes(".gov.uk")
  ) {
    return null;
  }

  // `source` is like "socrata:New York" — extract the city after the
  // colon. If no colon, use the source verbatim. Empty falls back to
  // the row's `city` column.
  const sourceCity =
    sourceRaw.includes(":")
      ? (row.source || "").split(":").slice(1).join(":").trim()
      : (row.source || row.city || "csv-import").trim();
  if (!sourceCity) return null;

  let raw: Record<string, unknown> | null = null;
  try {
    if (row.raw_data) raw = JSON.parse(row.raw_data);
  } catch {
    raw = null;
  }

  return {
    source_city: sourceCity,
    source_id: sourceId,
    permit_number: sourceId, // upstream id doubles as the human-readable permit#
    permit_type: mapPermitType(row.permit_type),
    status: statusForEnum(normalizeStatus(row.status)),
    description: (row.description || "").trim() || null,
    address,
    city: (row.city || "").trim() || null,
    state: (row.state || "").trim().toUpperCase().slice(0, 2) || null,
    zip: normZip(row.zip_code),
    applicant_name: (row.contractor || "").trim() || null,
    contractor_name: (row.contractor || "").trim() || null,
    estimated_value: parseNum(row.estimated_value),
    applied_date: normDate(row.issue_date),
    issued_date: normDate(row.issue_date),
    raw_json: raw,
  };
}

/* ── Resumable checkpoint ────────────────────────────────────────── */

interface State {
  cursor: number;
  ok: number;
  err: number;
  updated_at: string;
}

function loadState(): State | null {
  if (!fs.existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")) as State;
  } catch {
    return null;
  }
}

function saveState(state: State): void {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    /* ignore */
  }
}

function clearState(): void {
  try {
    if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
  } catch {
    /* ignore */
  }
}

/* ── Bulk upsert with retry ──────────────────────────────────────── */

/* In-batch dedup. The upstream CSV has duplicate (source_city,
 * source_id) pairs (~21k of 36k rows on the henri-data file).
 * Postgres rejects an UPSERT batch with `21000 ON CONFLICT DO UPDATE
 * command cannot affect row a second time` when two rows in the same
 * batch hit the same constraint. Dedup client-side first; last-write-
 * wins keeps the freshest representation. */
function dedupBatch(chunk: PermitInsert[]): PermitInsert[] {
  const m = new Map<string, PermitInsert>();
  for (const p of chunk) {
    m.set(`${p.source_city}${p.source_id}`, p);
  }
  return [...m.values()];
}

async function upsertChunk(
  chunk: PermitInsert[],
  depth: number,
): Promise<{ ok: number; err: number }> {
  if (chunk.length === 0) return { ok: 0, err: 0 };
  const deduped = dedupBatch(chunk);
  const { error } = await s
    .from("permits")
    .upsert(deduped, {
      onConflict: "source_city,source_id",
      ignoreDuplicates: false,
    });
  if (!error) return { ok: deduped.length, err: 0 };

  const msg = error.message ?? "";
  const isTimeout =
    error.code === "57014" ||
    /statement timeout|upstream request|fetch failed/i.test(msg);
  if (isTimeout && deduped.length > 25 && depth < 5) {
    const mid = Math.floor(deduped.length / 2);
    const a = await upsertChunk(deduped.slice(0, mid), depth + 1);
    const b = await upsertChunk(deduped.slice(mid), depth + 1);
    return { ok: a.ok + b.ok, err: a.err + b.err };
  }

  console.warn(
    `  chunk size=${deduped.length} failed: ${error.code ?? "?"} ${msg.slice(0, 200)}`,
  );
  return { ok: 0, err: deduped.length };
}

/* ── Main ──────────────────────────────────────────────────────── */

(async () => {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`File not found: ${CSV_PATH}`);
    process.exit(1);
  }
  console.log(`reading ${CSV_PATH} ...`);
  const t0 = Date.now();
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  console.log(
    `  read ${(raw.length / 1024 / 1024).toFixed(1)} MB in ${Date.now() - t0} ms`,
  );

  console.log("parsing CSV ...");
  const grid = parseCsv(raw);
  console.log(`  ${grid.length.toLocaleString()} rows`);

  if (grid.length < 2) {
    console.error("CSV too small or malformed");
    process.exit(1);
  }
  const header = grid[0].map((h) => h.trim());

  const permits: PermitInsert[] = [];
  const filtered = { noAddress: 0, noPermitId: 0, foreign: 0 };
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? "").trim();
    });
    const p = rowToPermit(obj);
    if (!p) {
      if (!obj.address) filtered.noAddress++;
      else if (!obj.permit_id && !obj.id) filtered.noPermitId++;
      else filtered.foreign++;
      continue;
    }
    permits.push(p);
  }
  console.log(
    `  kept ${permits.length.toLocaleString()} permits — filtered: noAddr=${filtered.noAddress}, noPermitId=${filtered.noPermitId}, foreign=${filtered.foreign}`,
  );

  const stateRows = new Map<string, number>();
  for (const p of permits) {
    const k = p.state ?? "??";
    stateRows.set(k, (stateRows.get(k) ?? 0) + 1);
  }
  const top = [...stateRows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log("\nTop 12 states:");
  for (const [st, c] of top) {
    console.log(`  ${st}: ${c.toLocaleString()}`);
  }

  let payload = permits;
  if (HARD_LIMIT > 0) {
    payload = payload.slice(0, HARD_LIMIT);
    console.log(`\n[IMPORT_LIMIT=${HARD_LIMIT}] capping`);
  }

  const FRESH = process.env.FRESH === "1";
  const stored = !FRESH ? loadState() : null;
  let cursor = 0;
  let totalOk = 0;
  let totalErr = 0;
  if (stored && stored.cursor > 0 && stored.cursor < payload.length) {
    cursor = stored.cursor;
    totalOk = stored.ok;
    totalErr = stored.err;
    console.log(
      `\nResuming from row ${cursor.toLocaleString()} (prior ok=${totalOk.toLocaleString()}, err=${totalErr})`,
    );
  } else if (FRESH) {
    clearState();
  }

  const BATCH = 200;
  console.log(
    `\nupserting ${payload.length.toLocaleString()} permits (batch=${BATCH}, starting at ${cursor.toLocaleString()}) ...`,
  );
  for (let i = cursor; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH);
    const r = await upsertChunk(chunk, 0);
    totalOk += r.ok;
    totalErr += r.err;
    saveState({
      cursor: i + chunk.length,
      ok: totalOk,
      err: totalErr,
      updated_at: new Date().toISOString(),
    });
    if ((i / BATCH) % 10 === 0) {
      console.log(
        `  ${totalOk.toLocaleString()} / ${payload.length.toLocaleString()} (errs=${totalErr})`,
      );
    }
  }
  clearState();

  console.log(
    `\nDone. +${totalOk.toLocaleString()} ok, ${totalErr} errors`,
  );

  const { count } = await s
    .from("permits")
    .select("id", { count: "estimated", head: true });
  console.log(`permits table size (est): ${count?.toLocaleString() ?? "?"}`);
})();
