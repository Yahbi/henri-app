/**
 * Import C:/Users/yabis/Desktop/Data Henri 3/accela_portals.csv (~99 rows)
 * into `permit_sources`.
 *
 * Schema:
 *   Zip,City,County,State,API_Available,Vendor,Portal_URL
 * (same shape as Massive_US_Permit_Mapping.csv but the API_Available
 *  column reads "No (Requires Auth Scraper/FOIA)" — i.e. these are
 *  auth-gated Accela ACA portals, NOT public APIs.)
 *
 * Why a separate importer:
 *   1. These rows land with auth='accela' instead of 'none' so the
 *      probe step doesn't try them via anonymous HTTP.
 *   2. enabled=false (they need a paid scraper or FOIA workflow before
 *      they go live — captured here for visibility, not active probing).
 *   3. Provenance tag data_henri_3_accela so a later "Accela scraper"
 *      project can pull just these rows.
 *
 * Idempotent on `source_key`. Tiny import (<100 rows) so a single batch.
 *
 * Usage:
 *   pnpm import:dh3-accela
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

const HARD_LIMIT = Number(process.env.IMPORT_LIMIT ?? 0);
const CSV_PATH =
  "C:/Users/yabis/Desktop/Data Henri 3/accela_portals.csv";

/* ── CSV parser ───────────────────────────────────────────────────── */

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

/* The accela_portals.csv has no header line — the first row is data,
 * and only the column ORDER matches the Massive_US schema. We hardcode
 * the column names accordingly. */
const ACCELA_HEADER = [
  "Zip", "City", "County", "State", "API_Available", "Vendor", "Portal_URL",
] as const;

function readCsvObjects(filePath: string): Array<Record<string, string>> {
  if (!fs.existsSync(filePath)) {
    console.warn(`  [csv] file not found: ${filePath}`);
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const grid = parseCsv(raw);
  if (grid.length < 1) return [];
  // Detect whether row 0 is a header (first cell is a non-numeric word
  // like "Zip") or already data (first cell is a 5-digit zip).
  const first = grid[0]?.[0] ?? "";
  const headerless = /^\d{5}$/.test(first);
  const startIdx = headerless ? 0 : 1;
  const out: Array<Record<string, string>> = [];
  for (let r = startIdx; r < grid.length; r++) {
    const cells = grid[r];
    const obj: Record<string, string> = {};
    ACCELA_HEADER.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? "").trim();
    });
    out.push(obj);
  }
  return out;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function slug(v: string): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isForeignDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host.endsWith(".gov.co") ||
      host.endsWith(".gob.mx") ||
      host.endsWith(".gov.uk") ||
      host.endsWith(".gov.ca")
    )
      return true;
    if (/\.(gov\.[a-z]{2,3})$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/* ── Canonical row ─────────────────────────────────────────────── */

type SourceRow = {
  source_key: string;
  name: string;
  state: string;
  city: string | null;
  jurisdiction: string | null;
  endpoint: string;
  source_type: "unknown";
  auth: string;
  enabled: boolean;
  discovered_via: "data_henri_3_accela";
  field_mapping_status: "unknown";
  imported_at: string;
  notes: string | null;
};

function buildKey(
  platform: string,
  state: string,
  city: string | null,
  name: string,
  endpoint: string,
): string {
  const epHash = slug(endpoint).slice(-12);
  return `${platform}:${state}:${slug(city ?? "")}:${slug(name)}:${epHash}`.slice(0, 200);
}

/* ── Adapter ──────────────────────────────────────────────────────── */

function adapt(rows: Array<Record<string, string>>): {
  out: SourceRow[];
  filtered: { noEndpoint: number; foreign: number; noState: number };
} {
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const filtered = { noEndpoint: 0, foreign: 0, noState: 0 };
  const now = new Date().toISOString();
  for (const r of rows) {
    const ep = (r.Portal_URL || "").trim();
    if (!ep || !ep.startsWith("http")) {
      filtered.noEndpoint++;
      continue;
    }
    if (isForeignDomain(ep)) {
      filtered.foreign++;
      continue;
    }
    const stateUpper = (r.State || "").trim().toUpperCase();
    const state =
      stateUpper && /^[A-Z]{2}$/.test(stateUpper) ? stateUpper : "";
    if (!state) {
      filtered.noState++;
      continue;
    }
    const city = (r.City || "").trim() || null;
    const jurisdiction = (r.County || "").trim() || null;
    const name = `Accela ACA — ${city ?? jurisdiction ?? state}`;
    const notes = [
      r.Zip ? `zip=${r.Zip}` : "",
      r.API_Available ? `auth_note=${r.API_Available}` : "",
      "vendor=accela",
    ]
      .filter(Boolean)
      .join(" | ");

    const row: SourceRow = {
      source_key: buildKey("accela", state, city, name, ep),
      name: name.slice(0, 300),
      state,
      city,
      jurisdiction,
      endpoint: ep,
      source_type: "unknown",
      auth: "accela",
      enabled: false,
      discovered_via: "data_henri_3_accela",
      field_mapping_status: "unknown",
      imported_at: now,
      notes: notes.slice(0, 1000) || null,
    };
    if (!seen.has(row.source_key)) {
      seen.add(row.source_key);
      out.push(row);
    }
  }
  return { out, filtered };
}

/* ── Provenance graceful-degrade fallback ────────────────────────── */

type StrippedRow = Omit<
  SourceRow,
  "discovered_via" | "field_mapping_status" | "imported_at" | "notes"
>;
function stripProvenance(rows: SourceRow[]): StrippedRow[] {
  return rows.map((r) => {
    const {
      discovered_via: _dv,
      field_mapping_status: _fms,
      imported_at: _ia,
      notes: _n,
      ...rest
    } = r;
    void _dv;
    void _fms;
    void _ia;
    void _n;
    return rest;
  });
}

/* ── Bulk upsert ─────────────────────────────────────────────────── */

async function upsertChunk(
  label: string,
  chunk: SourceRow[],
  useStrippedRef: { value: boolean },
  depth: number,
): Promise<{ ok: number; err: number }> {
  if (chunk.length === 0) return { ok: 0, err: 0 };
  const payload = useStrippedRef.value ? stripProvenance(chunk) : chunk;
  const { error } = await s
    .from("permit_sources")
    .upsert(payload, { onConflict: "source_key", ignoreDuplicates: false });
  if (!error) return { ok: chunk.length, err: 0 };
  const msg = error.message ?? "";
  const missingCol =
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist/i.test(msg) ||
    /could not find the .* column/i.test(msg) ||
    /schema cache/i.test(msg);
  if (missingCol && !useStrippedRef.value) {
    useStrippedRef.value = true;
    console.log(
      `  [${label}] migration 00052 columns missing — falling back to legacy schema`,
    );
    return upsertChunk(label, chunk, useStrippedRef, depth);
  }
  const isTimeout =
    error.code === "57014" ||
    /statement timeout/i.test(msg) ||
    /canceling statement/i.test(msg) ||
    /upstream request timeout/i.test(msg) ||
    /504/i.test(msg) ||
    /522/i.test(msg);
  if (isTimeout && chunk.length > 10 && depth < 6) {
    const mid = Math.floor(chunk.length / 2);
    const a = await upsertChunk(label, chunk.slice(0, mid), useStrippedRef, depth + 1);
    const b = await upsertChunk(label, chunk.slice(mid), useStrippedRef, depth + 1);
    return { ok: a.ok + b.ok, err: a.err + b.err };
  }
  console.warn(
    `  [${label}] chunk size=${chunk.length} failed: ${error.code ?? "?"} ${msg.slice(0, 200)}`,
  );
  return { ok: 0, err: chunk.length };
}

async function upsertBatch(
  label: string,
  rows: SourceRow[],
): Promise<{ ok: number; err: number }> {
  const BATCH = 100;
  let ok = 0;
  let err = 0;
  const useStrippedRef = { value: false };
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const r = await upsertChunk(label, chunk, useStrippedRef, 0);
    ok += r.ok;
    err += r.err;
  }
  return { ok, err };
}

/* ── Main ─────────────────────────────────────────────────────────── */

(async () => {
  console.log(`reading ${CSV_PATH} ...`);
  const rows = readCsvObjects(CSV_PATH);
  console.log(`  ${rows.length.toLocaleString()} raw rows`);

  const adapted = adapt(rows);
  console.log(
    `\n[data_henri_3_accela] kept ${adapted.out.length.toLocaleString()} rows`,
  );
  console.log(
    `  filtered: noEndpoint=${adapted.filtered.noEndpoint}, ` +
      `foreign=${adapted.filtered.foreign}, ` +
      `noState=${adapted.filtered.noState}`,
  );

  const stateCount = new Map<string, number>();
  for (const r of adapted.out) {
    stateCount.set(r.state, (stateCount.get(r.state) ?? 0) + 1);
  }
  const top = [...stateCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log("\nTop states:");
  for (const [st, c] of top) {
    console.log(`  ${st}: ${c}`);
  }

  let payload = adapted.out;
  if (HARD_LIMIT > 0) payload = payload.slice(0, HARD_LIMIT);

  console.log(`\nupserting ${payload.length} rows ...`);
  const res = await upsertBatch("data_henri_3_accela", payload);
  console.log(
    `\n[data_henri_3_accela] +${res.ok} ok, ${res.err} errors`,
  );

  console.log("\ndone.");
})();
