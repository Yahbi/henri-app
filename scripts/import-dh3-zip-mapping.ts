/**
 * Import C:/Users/yabis/Desktop/Data Henri 3/Massive_US_Permit_Mapping.csv
 * (~33,306 rows, ~5.7MB) into `permit_sources`.
 *
 * Schema (7 columns, ZIP-anchored portal map):
 *   Zip,City,County,State,API_Available,Vendor,Portal_URL
 *
 * Why a separate importer:
 *   1. Different shape entirely — this is a ZIP→portal index, not a
 *      Socrata/ArcGIS dataset catalog. The "Portal_URL" column is the
 *      landing page (e.g. an ArcGIS Hub experience, a HUD opendata
 *      explorer, or a featureserver root) — which is exactly what
 *      `endpoint` should be when there's no specific resource ID.
 *   2. Vendor is one of: ArcGIS, ArcGIS Hub, Socrata, HUD, Census Bureau.
 *      We map HUD → ckan-shaped (data.json catalog) and Census Bureau →
 *      unknown so the probe step routes them through a generic HTTP probe.
 *   3. ~6,322 unique endpoints across 33k rows — the same vendor portal
 *      gets repeated by ZIP, so source_key dedup will collapse the spam.
 *
 * Idempotent on `source_key`. Lands enabled=false. Provenance tag:
 * data_henri_3_zip_mapping.
 *
 * Usage:
 *   pnpm import:dh3-zip-mapping
 *   IMPORT_LIMIT=200 pnpm import:dh3-zip-mapping   # smoke test
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
  "C:/Users/yabis/Desktop/Data Henri 3/Massive_US_Permit_Mapping.csv";

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

/* ── Helpers ──────────────────────────────────────────────────────── */

function slug(v: string): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

type Platform = "arcgis" | "socrata" | "ckan" | "csv" | "unknown";

function platformFromUrl(url: string): Platform {
  const u = (url ?? "").toLowerCase();
  if (
    u.includes("arcgis.com") ||
    u.includes("/arcgis/rest/services") ||
    u.includes("featureserver") ||
    u.includes("mapserver")
  )
    return "arcgis";
  if (/\/resource\/[a-z0-9-]+\.json/.test(u)) return "socrata";
  if (/\/api\/views\//.test(u)) return "socrata";
  if (/data\.[^/]+\.(gov|org|us|com)\/data\.json$/.test(u)) return "ckan";
  if (u.endsWith(".csv") || u.includes("/datastore/dump/")) return "csv";
  return "unknown";
}

function normVendor(raw: string, url: string): Platform {
  const low = (raw ?? "").toLowerCase().trim();
  if (low.includes("arcgis")) return "arcgis";
  if (low.includes("socrata")) return "socrata";
  // HUD opendata is ArcGIS-Hub-shaped. Treat as arcgis if URL says so.
  if (low === "hud") {
    const fromUrl = platformFromUrl(url);
    return fromUrl === "unknown" ? "ckan" : fromUrl;
  }
  if (low.includes("census")) return "unknown";
  return platformFromUrl(url);
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

/* ── Permit-relevance filter (canonical) ─────────────────────────── */

const POSITIVE = [
  "permit", "construction", "building", "remodel", "renovation",
  "addition", "ADU", "solar", "roof", "hvac", "plumbing", "electrical",
  "demolition", "septic", "code enforcement", "zoning", "subdivision",
  "right of way", "ROW", "site plan", "PUD", "variance",
  "certificate of occupancy", "inspection",
];
const NEGATIVE = [
  "film", "parade", "marriage", "marijuana", "cannabis", "alcohol",
  "liquor", "firearm", "weapon", "concealed carry", "fishing", "hunt",
  "huntinng",
  "dog license", "pet license", "burn permit", "fire permit",
  "block party", "garage sale", "vendor", "food truck",
  "noise variance", "special event", "outdoor event", "tobacco",
  "pesticide", "skate park", "playground", "marriages",
  "reintegración", "datos.gov.co",
];

function isPermitRelevant(...fields: (string | undefined)[]): boolean {
  const haystack = fields.map((f) => (f ?? "").toLowerCase()).join(" ");
  if (haystack.length === 0) return false;
  for (const n of NEGATIVE) {
    if (haystack.includes(n.toLowerCase())) return false;
  }
  for (const p of POSITIVE) {
    if (haystack.includes(p.toLowerCase())) return true;
  }
  return false;
}

/* ── Canonical row ─────────────────────────────────────────────── */

type SourceRow = {
  source_key: string;
  name: string;
  state: string;
  city: string | null;
  jurisdiction: string | null;
  endpoint: string;
  source_type: Platform;
  auth: string;
  enabled: boolean;
  discovered_via: "data_henri_3_zip_mapping";
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
  filtered: {
    noEndpoint: number;
    notAvailable: number;
    notRelevant: number;
    foreign: number;
    noState: number;
  };
} {
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const filtered = {
    noEndpoint: 0,
    notAvailable: 0,
    notRelevant: 0,
    foreign: 0,
    noState: 0,
  };
  const now = new Date().toISOString();
  for (const r of rows) {
    const avail = (r.API_Available || "").toLowerCase();
    // Drop "No" rows — they're auth-required portals captured separately
    // by the accela-portals importer.
    if (!avail.startsWith("yes")) {
      filtered.notAvailable++;
      continue;
    }
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
    // Permit-relevance: API_Available + Vendor name is the only signal we
    // have. The string "permit" appears in API_Available ("County-level: HUD")
    // and the URL often contains "permits" or "buildings". Fall back to
    // checking the URL too.
    if (!isPermitRelevant(r.API_Available, r.Vendor, ep)) {
      filtered.notRelevant++;
      continue;
    }
    const platform = normVendor(r.Vendor || "", ep);
    const city = (r.City || "").trim() || null;
    const jurisdiction = (r.County || "").trim() || null;
    const vendorLabel = (r.Vendor || "").trim() || platform;
    const name = `${vendorLabel} portal — ${city ?? jurisdiction ?? state}`;

    const notes = [
      r.Zip ? `zip=${r.Zip}` : "",
      r.API_Available ? `coverage=${r.API_Available}` : "",
      r.Vendor ? `vendor=${r.Vendor}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const row: SourceRow = {
      source_key: buildKey(platform, state, city, name, ep),
      name: name.slice(0, 300),
      state,
      city,
      jurisdiction,
      endpoint: ep,
      source_type: platform,
      auth: "none",
      enabled: false,
      discovered_via: "data_henri_3_zip_mapping",
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
  const BATCH = 250;
  let ok = 0;
  let err = 0;
  const useStrippedRef = { value: false };
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const r = await upsertChunk(label, chunk, useStrippedRef, 0);
    ok += r.ok;
    err += r.err;
    if ((i / BATCH) % 4 === 0) {
      console.log(
        `  [${label}] ${ok.toLocaleString()} / ${rows.length.toLocaleString()} (errs=${err})`,
      );
    }
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
    `\n[data_henri_3_zip_mapping] kept ${adapted.out.length.toLocaleString()} rows`,
  );
  console.log(
    `  filtered: notAvailable=${adapted.filtered.notAvailable.toLocaleString()}, ` +
      `noEndpoint=${adapted.filtered.noEndpoint.toLocaleString()}, ` +
      `notRelevant=${adapted.filtered.notRelevant.toLocaleString()}, ` +
      `foreign=${adapted.filtered.foreign.toLocaleString()}, ` +
      `noState=${adapted.filtered.noState.toLocaleString()}`,
  );

  const stateCount = new Map<string, number>();
  for (const r of adapted.out) {
    stateCount.set(r.state, (stateCount.get(r.state) ?? 0) + 1);
  }
  const top = [...stateCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log("\nTop 12 states in this batch:");
  for (const [st, c] of top) {
    console.log(`  ${st}: ${c.toLocaleString()}`);
  }

  let payload = adapted.out;
  if (HARD_LIMIT > 0) {
    payload = payload.slice(0, HARD_LIMIT);
    console.log(`\n[IMPORT_LIMIT=${HARD_LIMIT}] capping`);
  }

  console.log(`\nupserting ${payload.length.toLocaleString()} rows ...`);
  const res = await upsertBatch("data_henri_3_zip_mapping", payload);
  console.log(
    `\n[data_henri_3_zip_mapping] +${res.ok.toLocaleString()} ok, ${res.err} errors`,
  );

  const { count: totalCount } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  console.log(
    `\npermit_sources total now: ${totalCount?.toLocaleString() ?? "?"}`,
  );

  console.log("\ndone.");
})();
