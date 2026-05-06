/**
 * Import the seven `endpoint_url`-style catalogs from
 * `C:/Users/yabis/Desktop/henri data/` into `permit_sources`:
 *
 *   1. us_all_jurisdictions_permit_apis.csv (~43k rows)  — biggest catalog
 *   2. us_building_permit_apis_complete.csv  (~52 rows)  — small subset
 *   3. us_permit_apis_VERIFIED.csv           (~91 rows)  — verified, has verified_date
 *   4. us_research_verified_apis.csv         (~43 rows)  — research-verified
 *   5. us_verified_permit_apis.csv           (~55 rows)  — different col set (verified=yes)
 *   6. us_verified_working_apis.csv          (~3.1k rows) — HTTP-probed (status,response_time_ms)
 *
 *   `us_research_verified_apis (1).csv` is byte-identical to (4) — skipped.
 *
 * All files share the `source_type,jurisdiction,jurisdiction_type,state,...,
 * endpoint_url,...` schema family (or a close variant), so a single adapter
 * with a few fallback column-name lookups handles them all.
 *
 * Files whose name implies validation (*VERIFIED* / *verified_working* /
 * *research_verified*) land with `enabled=true`, `field_mapping_status='probed'`,
 * `priority=10`. Otherwise `enabled=false`.
 *
 * Shape contract matches scripts/import-live-master.ts (source_key UPSERT,
 * recursive batch-halving on Supabase 57014/timeout, graceful-degrade if
 * provenance columns from migration 00052 are missing).
 *
 * Usage:
 *   pnpm import:hd-jurisdictions
 *   IMPORT_LIMIT=200 pnpm import:hd-jurisdictions   # smoke test
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

/* ── CSV parser (quote-aware, multi-line tolerant — verbatim from
 *    import-live-master.ts) ─────────────────────────────────────── */

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

/* ── Normalizers (copied verbatim from import-desktop-catalogs.ts) ── */

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
  if (up === "NATIONWIDE" || up === "USA" || up === "US" || up === "NATIONAL") return "";
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
  if (low.includes("census")) return "csv";
  return "";
}

/* ── Permit-relevance + foreign-domain filters ─────────────────── */

const POSITIVE = [
  "permit", "construction", "building", "remodel", "renovation",
  "addition", "ADU", "solar", "roof", "hvac", "plumbing", "electrical",
  "demolition", "septic", "code enforcement", "zoning", "subdivision",
  "right of way", "ROW", "site plan", "PUD", "variance",
  "certificate of occupancy", "inspection",
  // The big jurisdictions catalog tags many rows only as "Open Data Portal" — we still
  // want those because the portal IS the discovery surface for permits. Add portal-shaped
  // signals so we don't drop rows that lack a permit-keyword in their notes column.
  "open data portal", "data portal", "data catalog",
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

function isForeignDomain(domain: string): boolean {
  const dom = (domain ?? "").toLowerCase().trim();
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
  // Generic .gov.<2-3>` foreign TLD pattern.
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
  // Provenance columns — stripped if migration 00052 isn't applied.
  discovered_via: string;
  field_mapping_status: "probed" | "unmapped";
  priority: number;
  imported_at: string;
  notes: string | null;
};

function mkRow(partial: {
  platform: Platform;
  state: string;
  name: string;
  endpoint: string;
  city?: string | null;
  jurisdiction?: string | null;
  notes?: string | null;
  discovered_via: string;
  enabled: boolean;
  field_mapping_status: "probed" | "unmapped";
  priority: number;
  now: string;
}): SourceRow | null {
  if (!partial.endpoint || !partial.endpoint.startsWith("http")) return null;
  // Some catalogs put N/A or section headers — skip gracefully.
  if (/^(N\/A|None|null|undefined)$/i.test(partial.endpoint)) return null;
  if (!partial.state || partial.state.length !== 2) return null;
  const platform: Platform = partial.platform || platformFromUrl(partial.endpoint);
  return {
    source_key: buildKey(
      platform,
      partial.state,
      partial.city ?? null,
      partial.name,
      partial.endpoint,
    ),
    name: (partial.name ?? "").slice(0, 300) || `${platform} ${partial.state}`,
    state: partial.state,
    city: partial.city ?? null,
    jurisdiction: partial.jurisdiction ?? null,
    endpoint: partial.endpoint,
    source_type: platform,
    auth: "none",
    enabled: partial.enabled,
    discovered_via: partial.discovered_via,
    field_mapping_status: partial.field_mapping_status,
    priority: partial.priority,
    imported_at: partial.now,
    notes: (partial.notes ?? "").slice(0, 1000) || null,
  };
}

/* ── Adapter (covers the common schema across all 6 files) ─────── */

type FileSpec = {
  filename: string;
  discovered_via: string;
  enabled: boolean;
  field_mapping_status: "probed" | "unmapped";
  priority: number;
  // When true, skip the keyword filter — file name claims pre-validation,
  // and the rows describe jurisdiction-level data portals (not specific
  // datasets), so the keyword filter would drop them all.
  trustValidatedJurisdiction?: boolean;
};

const FILES: FileSpec[] = [
  // Big catalog — permissive (state portals are discovery surfaces, not always permit-tagged).
  {
    filename: "us_all_jurisdictions_permit_apis.csv",
    discovered_via: "henri_data_jurisdictions",
    enabled: false,
    field_mapping_status: "unmapped",
    priority: 5,
  },
  {
    filename: "us_building_permit_apis_complete.csv",
    discovered_via: "henri_data_building_complete",
    enabled: false,
    field_mapping_status: "unmapped",
    priority: 5,
  },
  // Verified files — promote to enabled=true, probed.
  {
    filename: "us_permit_apis_VERIFIED.csv",
    discovered_via: "henri_data_verified_apis",
    enabled: true,
    field_mapping_status: "probed",
    priority: 10,
  },
  {
    filename: "us_research_verified_apis.csv",
    discovered_via: "henri_data_research_verified",
    enabled: true,
    field_mapping_status: "probed",
    priority: 10,
  },
  {
    filename: "us_verified_permit_apis.csv",
    discovered_via: "henri_data_verified_permits",
    enabled: true,
    field_mapping_status: "probed",
    priority: 10,
  },
  {
    // 3.1k rows of HTTP-probed county/state ArcGIS Hubs and CKAN portals.
    // Notes column is "County ArcGIS Hub - Verify endpoint" (no permit keyword),
    // so we trust the upstream HTTP probe + the file name and skip keyword filtering.
    filename: "us_verified_working_apis.csv",
    discovered_via: "henri_data_verified_working",
    enabled: true,
    field_mapping_status: "probed",
    priority: 10,
    trustValidatedJurisdiction: true,
  },
];

type AdaptStats = {
  noEndpoint: number;
  notRelevant: number;
  badState: number;
  foreign: number;
  notWorking: number;
};

function adapt(
  rows: Array<Record<string, string>>,
  spec: FileSpec,
): { out: SourceRow[]; stats: AdaptStats } {
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const stats: AdaptStats = {
    noEndpoint: 0,
    notRelevant: 0,
    badState: 0,
    foreign: 0,
    notWorking: 0,
  };
  const now = new Date().toISOString();

  for (const r of rows) {
    // Endpoint: try endpoint_url first (most files), then fall back to other column names.
    const ep = (r.endpoint_url || r.api_endpoint || r.api_url || "").trim();
    if (!ep || !ep.startsWith("http")) {
      stats.noEndpoint++;
      continue;
    }

    // For *verified_working* the upstream verified each row with HTTP probes; if
    // status column says it's not working, skip. Other files don't have this col.
    const status = (r.status || "").toLowerCase().trim();
    if (status && status !== "verified_working" && status !== "ok" && status !== "200") {
      // Only enforce when the column exists with a non-blank value other than known-good.
      if (status.includes("error") || status.includes("fail") || status.includes("dead")) {
        stats.notWorking++;
        continue;
      }
    }

    // Foreign domain check on the domain column AND on the endpoint host itself.
    const domCol = (r.domain || "").toLowerCase();
    let host = "";
    try {
      host = new URL(ep).hostname.toLowerCase();
    } catch {
      // malformed URL; treat as bad endpoint
      stats.noEndpoint++;
      continue;
    }
    if (isForeignDomain(domCol) || isForeignDomain(host)) {
      stats.foreign++;
      continue;
    }

    // State extraction — try state_code, then state name lookup.
    const state = normState(r.state_code || r.state || "");
    if (!state || state.length !== 2) {
      stats.badState++;
      continue;
    }

    // Permit-relevance — uses notes + dataset_title + jurisdiction_type + api_type.
    // Skipped for files whose name + upstream probe already imply trust.
    if (!spec.trustValidatedJurisdiction) {
      const relevantFields = [
        r.notes,
        r.dataset_title,
        r.jurisdiction_type,
        r.api_type,
        r.dataset_id,
        r.jurisdiction,
      ].filter(Boolean) as string[];
      if (!isPermitRelevant(...relevantFields)) {
        stats.notRelevant++;
        continue;
      }
    } else {
      // Even on trusted files, drop obviously-non-permit rows by NEGATIVE keyword.
      const haystack = [
        r.notes,
        r.jurisdiction_type,
        r.dataset_title,
        r.dataset_id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const negHit = NEGATIVE.find((n) => haystack.includes(n.toLowerCase()));
      if (negHit) {
        stats.notRelevant++;
        continue;
      }
    }

    const platform: Platform =
      normPlatform(r.source_type || r.api_type || "") || platformFromUrl(ep);

    const jurType = (r.jurisdiction_type || "").toLowerCase();
    const city =
      jurType === "city" || jurType === "metro"
        ? r.jurisdiction || null
        : null;
    const jurisdiction = r.county || (jurType === "county" ? r.jurisdiction : null) || null;

    const name =
      r.dataset_title ||
      r.notes ||
      r.jurisdiction ||
      `${platform} ${state}`;

    const notesParts = [
      r.notes ? `notes=${r.notes.slice(0, 300)}` : "",
      r.api_type ? `api_type=${r.api_type}` : "",
      r.dataset_id ? `dataset_id=${r.dataset_id}` : "",
      r.verified_date ? `verified=${r.verified_date}` : "",
      r.response_time_ms ? `rt_ms=${r.response_time_ms}` : "",
      r.verified ? `verified=${r.verified}` : "",
      r.jurisdiction_type ? `jur_type=${r.jurisdiction_type}` : "",
    ].filter(Boolean);

    const row = mkRow({
      platform,
      state,
      name,
      endpoint: ep,
      city,
      jurisdiction,
      notes: notesParts.join(" | "),
      discovered_via: spec.discovered_via,
      enabled: spec.enabled,
      field_mapping_status: spec.field_mapping_status,
      priority: spec.priority,
      now,
    });

    if (row && !seen.has(row.source_key)) {
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

/* ── Bulk upsert with batch-halving on Supabase 57014 / upstream-timeout
 *    (verbatim port from import-live-master.ts) ─────────────────────── */

async function upsertChunk(
  label: string,
  chunk: SourceRow[],
  useStrippedRef: { value: boolean },
  depth: number,
): Promise<{ ok: number; err: number }> {
  if (chunk.length === 0) return { ok: 0, err: 0 };
  const payload = useStrippedRef.value ? stripProvenance(chunk) : chunk;

  // Retry up to 3 times on transient network errors before giving up.
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
    if ((i / BATCH) % 10 === 0) {
      console.log(
        `  [${label}] ${ok.toLocaleString()} / ${rows.length.toLocaleString()} (errs=${err})`,
      );
    }
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
      `  filtered: noEndpoint=${stats.noEndpoint}, notRelevant=${stats.notRelevant}, ` +
        `badState=${stats.badState}, foreign=${stats.foreign}, notWorking=${stats.notWorking}`,
    );
    console.log(`  kept ${out.length.toLocaleString()} unique rows`);

    let payload = out;
    if (HARD_LIMIT > 0) {
      payload = payload.slice(0, HARD_LIMIT);
      console.log(`  [IMPORT_LIMIT=${HARD_LIMIT}] capping`);
    }
    if (payload.length === 0) {
      console.log(`  [${spec.discovered_via}] nothing to upsert, skipping`);
      continue;
    }

    console.log(`  upserting ${payload.length.toLocaleString()} rows...`);
    const res = await upsertBatch(spec.discovered_via, payload);
    console.log(
      `  [${spec.discovered_via}] +${res.ok.toLocaleString()} ok, ${res.err} errors`,
    );
    grandTotal += res.ok;
    grandErr += res.err;
  }

  console.log(`\n=== Grand total ===`);
  console.log(`  +${grandTotal.toLocaleString()} ok across all files, ${grandErr} errors`);

  // Final enabled count
  const { count: enabledCount } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `permit_sources enabled=true now: ${enabledCount?.toLocaleString() ?? "?"}`,
  );

  console.log("\ndone.");
})();
