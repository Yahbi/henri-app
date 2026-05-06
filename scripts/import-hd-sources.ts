/**
 * Import the two `data_url`-schema catalogs from
 * `C:/Users/yabis/Desktop/henri data/`:
 *
 *   us_permit_sources_COMPLETE.csv  (~361 rows)
 *   us_permit_sources_EXTENDED.csv  (~394 rows — superset of COMPLETE)
 *
 * Both share the schema:
 *   jurisdiction,jurisdiction_type,state,source_type,data_url,format,
 *   coverage,access_method,notes
 *
 * Many rows are placeholder "Not_Available" entries (no real URL) — those
 * are filtered out. Federal-rollup rows (US Census BPS, HUD SOCDS) lack a
 * 2-letter state and we drop them too: the existing pipeline focuses on
 * city/county/state-level permit endpoints, not bulk national CSV dumps.
 *
 * Both files land with `enabled=false` (they're CURATED but not PROBED).
 * The bulk-probe pass is what flips enabled=true once the endpoint is
 * confirmed live.
 *
 * Idempotent on `source_key`. EXTENDED runs second so its richer rows win
 * any conflict.
 *
 * Usage:
 *   pnpm import:hd-sources
 *   IMPORT_LIMIT=200 pnpm import:hd-sources    # smoke test
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
const BASE = "C:/Users/yabis/Desktop/henri data";

/* ── CSV parser ─────────────────────────────────────────────────── */

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

/* ── Normalizers ────────────────────────────────────────────────── */

const STATE_NAMES: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR",
  CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE",
  FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID",
  ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS",
  KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS",
  MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT",
  VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",
  WISCONSIN: "WI", WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC",
};
function normState(raw: string): string {
  const up = (raw ?? "").trim().toUpperCase();
  if (!up) return "";
  if (up === "NATIONWIDE" || up === "USA" || up === "US" || up === "NATIONAL")
    return "";
  if (up.length === 2 && /^[A-Z]{2}$/.test(up)) return up;
  return STATE_NAMES[up] ?? "";
}

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
  // The COMPLETE/EXTENDED notes column reliably says "Socrata platform" /
  // "CKAN platform" / "ArcGIS Hub" — we let normPlatform handle that.
  if (/data\.[^/]+\.(gov|org|us|com)\/data\.json$/.test(u)) return "ckan";
  if (u.endsWith(".csv") || u.includes("/datastore/dump/")) return "csv";
  return "unknown";
}

function normPlatform(raw: string): Platform | "" {
  const low = (raw ?? "").toLowerCase().trim();
  if (low.includes("arcgis hub")) return "arcgis";
  if (low.includes("arcgis rest")) return "arcgis";
  if (low.includes("arcgis")) return "arcgis";
  if (low.includes("socrata")) return "socrata";
  if (low.includes("ckan")) return "ckan";
  if (low.includes("carto")) return "ckan";
  return "";
}

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

function isForeignDomain(host: string): boolean {
  const dom = (host ?? "").toLowerCase().trim();
  if (!dom) return false;
  if (
    dom.endsWith(".gov.co") ||
    dom.endsWith(".gob.mx") ||
    dom.endsWith(".gov.uk") ||
    dom.endsWith(".gov.ca") ||
    dom.endsWith(".gov.au") ||
    dom.endsWith(".gov.nz")
  )
    return true;
  if (/\.gov\.[a-z]{2,3}$/.test(dom)) return true;
  return false;
}

/* ── Canonical row factory ─────────────────────────────────────── */

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
  discovered_via: string;
  field_mapping_status: "probed" | "unmapped";
  priority: number;
  imported_at: string;
  notes: string | null;
};

/* ── Adapter for COMPLETE / EXTENDED schema ─────────────────────── */

type FileSpec = {
  filename: string;
  discovered_via: string;
};

const FILES: FileSpec[] = [
  // COMPLETE first so EXTENDED's superset overwrites where it has more data.
  { filename: "us_permit_sources_COMPLETE.csv", discovered_via: "henri_data_sources_complete" },
  { filename: "us_permit_sources_EXTENDED.csv", discovered_via: "henri_data_sources_extended" },
];

type AdaptStats = {
  noUrl: number;
  notAvailable: number;
  badState: number;
  foreign: number;
  notRelevant: number;
};

function adapt(
  rows: Array<Record<string, string>>,
  spec: FileSpec,
): { out: SourceRow[]; stats: AdaptStats } {
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const stats: AdaptStats = {
    noUrl: 0,
    notAvailable: 0,
    badState: 0,
    foreign: 0,
    notRelevant: 0,
  };
  const now = new Date().toISOString();

  for (const r of rows) {
    const ep = (r.data_url || "").trim();

    // Skip placeholder rows.
    if (!ep || ep === "N/A" || ep.toLowerCase() === "n/a" || ep.toLowerCase() === "none") {
      stats.notAvailable++;
      continue;
    }
    if (!ep.startsWith("http")) {
      stats.noUrl++;
      continue;
    }
    if ((r.source_type || "").toLowerCase() === "not_available") {
      stats.notAvailable++;
      continue;
    }

    let host = "";
    try {
      host = new URL(ep).hostname.toLowerCase();
    } catch {
      stats.noUrl++;
      continue;
    }
    if (isForeignDomain(host)) {
      stats.foreign++;
      continue;
    }

    const state = normState(r.state || "");
    if (!state || state.length !== 2) {
      // Federal/national rollups (US Census BPS, HUD) don't pin to a state — skip.
      stats.badState++;
      continue;
    }

    if (
      !isPermitRelevant(
        r.coverage,
        r.notes,
        r.jurisdiction,
        r.format,
        r.source_type,
      )
    ) {
      stats.notRelevant++;
      continue;
    }

    const platform: Platform =
      normPlatform(r.notes || r.source_type || "") ||
      platformFromUrl(ep);

    const jurType = (r.jurisdiction_type || "").toLowerCase();
    const city =
      jurType === "city" || jurType === "metro"
        ? r.jurisdiction || null
        : null;
    const jurisdiction =
      jurType === "county" ? r.jurisdiction || null : null;

    const name = (r.jurisdiction || "").trim() || `${platform} ${state}`;

    const notesParts = [
      r.coverage ? `coverage=${r.coverage.slice(0, 200)}` : "",
      r.format ? `format=${r.format}` : "",
      r.access_method ? `access=${r.access_method}` : "",
      r.notes ? `notes=${r.notes.slice(0, 300)}` : "",
      r.source_type ? `cat_type=${r.source_type}` : "",
    ].filter(Boolean);

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
      discovered_via: spec.discovered_via,
      field_mapping_status: "unmapped",
      priority: 5,
      imported_at: now,
      notes: notesParts.join(" | ").slice(0, 1000) || null,
    };

    if (!seen.has(row.source_key)) {
      seen.add(row.source_key);
      out.push(row);
    }
  }
  return { out, stats };
}

/* ── Provenance graceful-degrade fallback ─────────────────────── */

type StrippedRow = Omit<
  SourceRow,
  "discovered_via" | "field_mapping_status" | "priority" | "imported_at" | "notes"
>;
function stripProvenance(rows: SourceRow[]): StrippedRow[] {
  return rows.map((r) => {
    const {
      discovered_via: _dv,
      field_mapping_status: _fms,
      priority: _p,
      imported_at: _ia,
      notes: _n,
      ...rest
    } = r;
    void _dv;
    void _fms;
    void _p;
    void _ia;
    void _n;
    return rest;
  });
}

/* ── Bulk upsert ──────────────────────────────────────────────── */

async function upsertChunk(
  label: string,
  chunk: SourceRow[],
  useStrippedRef: { value: boolean },
  depth: number,
): Promise<{ ok: number; err: number }> {
  if (chunk.length === 0) return { ok: 0, err: 0 };
  const payload = useStrippedRef.value ? stripProvenance(chunk) : chunk;

  // Retry the upsert up to 3 times on transient network errors (TypeError:
  // fetch failed, ECONNRESET, etc.) before giving up. Supabase's edge
  // network occasionally drops the first request after an idle period.
  let attempt = 0;
  let error: { code?: string; message?: string } | null = null;
  while (attempt < 3) {
    try {
      const res = await s
        .from("permit_sources")
        .upsert(payload, {
          onConflict: "source_key",
          ignoreDuplicates: false,
        });
      error = res.error;
      if (!error) return { ok: chunk.length, err: 0 };
      // Non-network error — exit retry loop and use existing classification.
      break;
    } catch (e: unknown) {
      const errObj = e as { message?: string };
      const m = (errObj?.message ?? String(e)).toLowerCase();
      if (m.includes("fetch failed") || m.includes("econnreset") || m.includes("etimedout")) {
        attempt++;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
      }
      error = { code: "FETCH", message: errObj?.message ?? String(e) };
      break;
    }
  }
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
    /upstream/i.test(msg) ||
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

/* ── Main ──────────────────────────────────────────────────────── */

(async () => {
  let grandTotal = 0;
  let grandErr = 0;

  for (const spec of FILES) {
    const fp = `${BASE}/${spec.filename}`;
    console.log(`\n=== ${spec.filename} ===`);
    const rows = readCsvObjects(fp);
    console.log(`  ${rows.length.toLocaleString()} raw rows`);
    if (rows.length === 0) continue;

    const { out, stats } = adapt(rows, spec);
    console.log(
      `  filtered: noUrl=${stats.noUrl}, notAvailable=${stats.notAvailable}, ` +
        `badState=${stats.badState}, foreign=${stats.foreign}, notRelevant=${stats.notRelevant}`,
    );
    console.log(`  kept ${out.length.toLocaleString()} unique rows`);

    let payload = out;
    if (HARD_LIMIT > 0) {
      payload = payload.slice(0, HARD_LIMIT);
      console.log(`  [IMPORT_LIMIT=${HARD_LIMIT}] capping`);
    }
    if (payload.length === 0) continue;

    console.log(`  upserting ${payload.length.toLocaleString()} rows...`);
    const res = await upsertBatch(spec.discovered_via, payload);
    console.log(
      `  [${spec.discovered_via}] +${res.ok.toLocaleString()} ok, ${res.err} errors`,
    );
    grandTotal += res.ok;
    grandErr += res.err;
  }

  console.log(`\n=== Grand total ===`);
  console.log(`  +${grandTotal.toLocaleString()} ok, ${grandErr} errors`);

  const { count } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  console.log(`permit_sources now has ${count?.toLocaleString() ?? "?"} rows total`);

  console.log("\ndone.");
})();
