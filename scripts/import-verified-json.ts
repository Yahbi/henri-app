/**
 * Import the validated-live US permits JSON catalog
 * `us_full_construction_permits_property_insurance_apis_VERIFIED_2026-04-27.json`
 * (~138 MB, 93,327 sources, 83,439 verified-live as of 2026-04-26).
 *
 * Why a separate importer:
 *   1. Different top-level shape vs `import-master-json.ts`:
 *      - `national_federal` is an ARRAY (not an object with a `permits` key).
 *      - States live under `by_state` (not `states`).
 *      - Counties contain `county_level[]` (not `county_apis`) and `cities[]`
 *        whose values are direct ARRAYS of API rows (not `city_apis`).
 *      - There is NO `zip_index` — phase 2 (ZIP linkage) is intentionally
 *        skipped here; that's the canonical job of `import-master-json.ts`.
 *   2. Per-row `verification` block carries probe metadata
 *      (`status`, `http_status`, `response_time_ms`, `verification_date`).
 *      When `verification.status === 'verified_live'` (or http 200 + non-null
 *      response time) we mark the row `enabled=true`,
 *      `field_mapping_status='probed'`, `priority=10` — same pattern as
 *      `import-live-master.ts`. Otherwise `enabled=false`,
 *      `field_mapping_status='unknown'`.
 *   3. Separate provenance tag (`discovered_via='verified_master_json'`)
 *      so the founder can later distinguish probe-validated rows from
 *      bulk-imported uncurated ones.
 *
 * Defensive filters:
 *   - `isPermitRelevant` — drops film/marriage/marijuana/skate-park noise.
 *   - Foreign domain filter — `.gov.co`, `.gob.mx`, `.gov.uk`, etc. The
 *     upstream catalog is US-scoped but a small handful of foreign rows
 *     have leaked into prior imports; this is a belt-and-suspenders check.
 *   - URL must start with `http`.
 *
 * Memory note: 138MB JSON parses to ~600MB heap. The pnpm script wires
 *   NODE_OPTIONS=--max-old-space-size=4096 for headroom.
 *
 * Idempotent on `source_key` — re-runs are no-ops for unchanged rows but
 *   refresh `enabled` / `priority` / `field_mapping_status` (and any
 *   provenance columns when present) for rows whose verification flipped.
 *
 * Resumable via `scripts/.import-verified-json.state.json`.
 *
 * Phase 2 (permit_source_zips) is intentionally skipped — only
 *   `import-master-json.ts` populates that table from its `zip_index`.
 *   This adapter just lands the source rows.
 *
 * Usage:
 *   pnpm import:verified-json
 *   IMPORT_LIMIT=2000 pnpm import:verified-json   # smoke-test cap
 *   FRESH=1 pnpm import:verified-json             # ignore checkpoint
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

const HARD_LIMIT = Number(process.env.IMPORT_LIMIT ?? 0); // 0 = unlimited

// Probe known locations at runtime so re-runs survive desktop reshuffles.
const JSON_CANDIDATES = [
  "C:/Users/yabis/Desktop/Data Henri 3/us_full_construction_permits_property_insurance_apis_VERIFIED_2026-04-27.json",
  "C:/Users/yabis/Desktop/us_full_construction_permits_property_insurance_apis_VERIFIED_2026-04-27.json",
  "C:/Users/yabis/Desktop/henri data/us_full_construction_permits_property_insurance_apis_VERIFIED_2026-04-27.json",
];
const JSON_PATH =
  JSON_CANDIDATES.find((p) => fs.existsSync(p)) ?? JSON_CANDIDATES[0];

/* ── Helpers copied verbatim from import-master-json.ts ──────────── */

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
  return "";
}

const POSITIVE = [
  "permit",
  "construction",
  "building",
  "remodel",
  "renovation",
  "addition",
  "ADU",
  "solar",
  "roof",
  "hvac",
  "plumbing",
  "electrical",
  "demolition",
  "septic",
  "code enforcement",
  "zoning",
  "subdivision",
  "right of way",
  "ROW",
  "site plan",
  "PUD",
  "variance",
  "certificate of occupancy",
  "inspection",
  "address", // National Address Database derivatives
  "parcel",
  "property",
  "housing",
];
const NEGATIVE = [
  "film",
  "parade",
  "marriage",
  "marijuana",
  "cannabis",
  "alcohol",
  "liquor",
  "firearm",
  "weapon",
  "concealed carry",
  "fishing",
  "hunt",
  "huntinng",
  "dog license",
  "pet license",
  "burn permit",
  "fire permit",
  "block party",
  "garage sale",
  "vendor",
  "food truck",
  "noise variance",
  "special event",
  "outdoor event",
  "tobacco",
  "pesticide",
  "skate park",
  "playground",
  "marriages",
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

function isForeignDomain(url: string): boolean {
  const dom = (url ?? "").toLowerCase();
  // Match "*.gov.co", "*.gob.mx", "*.gov.uk", "*.gov.au", "*.gc.ca", etc.
  if (
    dom.includes(".gov.co") ||
    dom.includes(".gob.mx") ||
    dom.includes(".gov.uk") ||
    dom.includes(".gov.au") ||
    dom.includes(".gc.ca") ||
    dom.includes(".gov.in") ||
    dom.includes(".gob.es")
  )
    return true;
  // Generic country-suffix .gov.XX where XX is a 2-letter country code
  // other than US. Be careful — `.gov` (federal) and `.us` (US states) must
  // pass through.
  const foreignTld = /\.gov\.([a-z]{2,3})(?:[/:]|$)/;
  const m = foreignTld.test(dom) ? foreignTld.exec(dom) : null;
  if (m && m[1] !== "us") return true;
  return false;
}

/* ── Canonical row factory ───────────────────────────────────────── */

type DiscoveredVia =
  | "us_master_csv"
  | "nationwide_csv"
  | "us_master_json"
  | "live_permits_master"
  | "verified_master_json";

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
  discovered_via: DiscoveredVia;
  field_mapping_status: "probed" | "unknown";
  priority: number;
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
  return `${platform}:${state}:${slug(city ?? "")}:${slug(name)}:${epHash}`.slice(
    0,
    200,
  );
}

function mkRow(partial: {
  platform: Platform;
  state: string;
  name: string;
  endpoint: string;
  city?: string | null;
  jurisdiction?: string | null;
  notes?: string | null;
  enabled: boolean;
  field_mapping_status: "probed" | "unknown";
  priority: number;
  discoveredVia: DiscoveredVia;
}): SourceRow | null {
  const ep = (partial.endpoint ?? "").trim();
  if (!ep || !ep.startsWith("http")) return null;
  const state = partial.state || "US";
  return {
    source_key: buildKey(
      partial.platform,
      state,
      partial.city ?? null,
      partial.name,
      ep,
    ),
    name:
      ((partial.name ?? "").slice(0, 300) || `${partial.platform} ${state}`).trim(),
    state,
    city: partial.city || null,
    jurisdiction: partial.jurisdiction || null,
    endpoint: ep,
    source_type: partial.platform,
    auth: "none",
    enabled: partial.enabled,
    discovered_via: partial.discoveredVia,
    field_mapping_status: partial.field_mapping_status,
    priority: partial.priority,
    imported_at: new Date().toISOString(),
    notes: (partial.notes ?? null)?.toString().slice(0, 1000) ?? null,
  };
}

/* ── Provenance graceful-degrade fallback ───────────────────────── */

type StrippedRow = Omit<
  SourceRow,
  | "discovered_via"
  | "field_mapping_status"
  | "priority"
  | "imported_at"
  | "notes"
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

let provenanceMissing = false;

async function upsertChunkWithRetry(
  label: string,
  chunk: SourceRow[],
  depth: number,
): Promise<{ ok: number; err: number }> {
  if (chunk.length === 0) return { ok: 0, err: 0 };
  const payload = provenanceMissing ? stripProvenance(chunk) : chunk;
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
  if (missingCol && !provenanceMissing) {
    provenanceMissing = true;
    console.log(
      `  [${label}] migration 00052 columns missing — falling back to legacy schema`,
    );
    return upsertChunkWithRetry(label, chunk, depth);
  }

  const isTimeout =
    error.code === "57014" ||
    /statement timeout/i.test(msg) ||
    /canceling statement/i.test(msg);
  if (isTimeout && chunk.length > 25 && depth < 6) {
    const mid = Math.floor(chunk.length / 2);
    const a = await upsertChunkWithRetry(label, chunk.slice(0, mid), depth + 1);
    const b = await upsertChunkWithRetry(label, chunk.slice(mid), depth + 1);
    return { ok: a.ok + b.ok, err: a.err + b.err };
  }

  console.warn(
    `  [${label}] chunk size=${chunk.length} failed: ${error.code ?? "?"} ${msg.slice(0, 200)}`,
  );
  return { ok: 0, err: chunk.length };
}

/* ── Resumable checkpoint ─────────────────────────────────────────── */

const STATE_PATH = path.resolve(
  process.cwd(),
  "scripts",
  ".import-verified-json.state.json",
);

interface ImportState {
  cursor: number;
  ok: number;
  err: number;
  updated_at: string;
}

function loadState(): ImportState | null {
  if (!fs.existsSync(STATE_PATH)) return null;
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw) as ImportState;
  } catch {
    return null;
  }
}

function saveState(state: ImportState): void {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // best-effort
  }
}

function clearState(): void {
  try {
    if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
  } catch {
    // ignore
  }
}

async function upsertBatch(
  label: string,
  rows: SourceRow[],
): Promise<{ ok: number; err: number }> {
  // Mixed enabled/disabled rows — match `import-master-json.ts`'s 200-row
  // batch size which has been tuned for the service-role pool's
  // statement_timeout. Halving on timeout is automatic via retry.
  const BATCH = 200;
  const FRESH = process.env.FRESH === "1";

  const stored = !FRESH ? loadState() : null;
  let startCursor = 0;
  let ok = 0;
  let err = 0;
  if (stored && stored.cursor > 0 && stored.cursor < rows.length) {
    startCursor = stored.cursor;
    ok = stored.ok;
    err = stored.err;
    console.log(
      `  [${label}] resuming from row ${startCursor.toLocaleString()} (prior ok=${ok.toLocaleString()}, err=${err})`,
    );
    console.log(
      `  [${label}] pass FRESH=1 to ignore checkpoint and restart from 0`,
    );
  } else if (FRESH) {
    clearState();
  }

  for (let i = startCursor; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const r = await upsertChunkWithRetry(label, chunk, 0);
    ok += r.ok;
    err += r.err;
    saveState({
      cursor: i + chunk.length,
      ok,
      err,
      updated_at: new Date().toISOString(),
    });
    if ((i / BATCH) % 10 === 0) {
      console.log(
        `  [${label}] ${ok.toLocaleString()} / ${rows.length.toLocaleString()} (errs=${err})`,
      );
    }
  }
  clearState();
  return { ok, err };
}

/* ── JSON shape (loose; we don't fight the upstream casing) ───────── */

type Verification = {
  status?: "verified_live" | "partial" | "failed" | string;
  http_status?: number | null;
  response_time_ms?: number | null;
  verification_date?: string | null;
  data_quality_notes?: string | null;
};

type ApiRow = {
  source_name?: string;
  data_type?: string;
  description?: string;
  endpoint_url?: string;
  documentation_url?: string;
  platform?: string;
  formats?: string[];
  permit_types?: string[];
  coverage?: string;
  notes?: string;
  verification?: Verification;
};

// City nodes are direct arrays of ApiRow in this catalog (e.g.
// `cities["Alameda"] = [api1, api2, ...]`). Defensively also accept the
// objectified `{ city_apis: [...] }` shape that `import-master-json.ts`
// uses, just in case future regenerations standardize on that shape.
type CityNode = ApiRow[] | { city_apis?: ApiRow[]; apis?: ApiRow[] };

type CountyNode = {
  county_level?: ApiRow[];
  cities?: Record<string, CityNode>;
};

type StateNode = {
  state_level?: ApiRow[];
  counties?: Record<string, CountyNode>;
};

type VerifiedJson = {
  metadata?: Record<string, unknown>;
  national_federal?: ApiRow[];
  by_state?: Record<string, StateNode>;
};

/* ── Verification → enabled / field_mapping_status / priority ─────── */

function classifyVerification(v: Verification | undefined): {
  enabled: boolean;
  field_mapping_status: "probed" | "unknown";
  priority: number;
} {
  if (!v) {
    return { enabled: false, field_mapping_status: "unknown", priority: 0 };
  }
  const live = v.status === "verified_live";
  const httpOk =
    typeof v.http_status === "number" &&
    v.http_status >= 200 &&
    v.http_status < 300 &&
    typeof v.response_time_ms === "number";
  if (live || httpOk) {
    return { enabled: true, field_mapping_status: "probed", priority: 10 };
  }
  return { enabled: false, field_mapping_status: "unknown", priority: 0 };
}

/* ── Build SourceRow from ApiRow + scope ──────────────────────────── */

function adaptApi(opts: {
  api: ApiRow;
  state: string;
  city: string | null;
  county: string | null;
}): SourceRow | null {
  const api = opts.api;
  const name = (api.source_name ?? "").trim();
  const ep = (api.endpoint_url ?? "").trim();
  if (!ep.startsWith("http")) return null;
  if (isForeignDomain(ep)) return null;
  // Build relevance haystack across all the human-readable fields. The
  // upstream `permit_types` array often holds the strongest signal
  // ("Building Permits", "Federal Permits"); flatten it into the search.
  const permitTypes = Array.isArray(api.permit_types)
    ? api.permit_types.join(" ")
    : "";
  const haystack = [
    name,
    api.description,
    api.notes,
    api.data_type,
    api.coverage,
    permitTypes,
  ]
    .filter(Boolean)
    .join(" | ");
  if (!isPermitRelevant(haystack)) return null;
  const platform: Platform =
    normPlatform(api.platform ?? "") || platformFromUrl(ep);
  const cls = classifyVerification(api.verification);
  const verifSummary = api.verification
    ? `verif=${api.verification.status ?? "?"}/${api.verification.http_status ?? "?"}/${api.verification.response_time_ms ?? "?"}ms`
    : "verif=none";
  const notesParts = [
    api.description ? `desc=${api.description.slice(0, 300)}` : "",
    api.coverage ? `coverage=${api.coverage.slice(0, 80)}` : "",
    permitTypes ? `permit_types=${permitTypes.slice(0, 80)}` : "",
    api.data_type ? `data_type=${api.data_type}` : "",
    verifSummary,
    api.documentation_url && api.documentation_url !== ep
      ? `docs=${api.documentation_url}`
      : "",
  ].filter((str) => str.length > 0);
  return mkRow({
    platform,
    state: opts.state,
    name,
    endpoint: ep,
    city: opts.city,
    jurisdiction: opts.county,
    notes: notesParts.join(" | "),
    enabled: cls.enabled,
    field_mapping_status: cls.field_mapping_status,
    priority: cls.priority,
    discoveredVia: "verified_master_json",
  });
}

/** Normalize a city node which may be a direct array or a wrapper. */
function cityApis(node: CityNode | undefined): ApiRow[] {
  if (!node) return [];
  if (Array.isArray(node)) return node;
  return node.city_apis ?? node.apis ?? [];
}

/* ── Main ─────────────────────────────────────────────────────────── */

(async () => {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`Verified JSON not found at ${JSON_PATH}`);
    process.exit(1);
  }

  console.log(`reading ${JSON_PATH} ...`);
  const t0 = Date.now();
  const raw = fs.readFileSync(JSON_PATH, "utf-8");
  console.log(
    `  read ${(raw.length / 1024 / 1024).toFixed(1)} MB in ${Date.now() - t0} ms`,
  );

  const t1 = Date.now();
  const data = JSON.parse(raw) as VerifiedJson;
  console.log(`  parsed in ${Date.now() - t1} ms`);

  if (data.metadata) {
    // Metadata block carries the upstream verification summary —
    // log it so the operator can sanity-check scale before the upsert
    // starts hammering Supabase.
    console.log("metadata:", JSON.stringify(data.metadata));
  }

  /* ── Phase 1: walk APIs at all levels → permit_sources ─────────── */

  type WalkStat = {
    walked: number;
    kept: number;
    dropForeign: number;
    dropIrrelevant: number;
    dropNoUrl: number;
    enabled: number;
  };

  function emptyStat(): WalkStat {
    return {
      walked: 0,
      kept: 0,
      dropForeign: 0,
      dropIrrelevant: 0,
      dropNoUrl: 0,
      enabled: 0,
    };
  }

  const stat = {
    federal: emptyStat(),
    state: emptyStat(),
    county: emptyStat(),
    city: emptyStat(),
  };

  const allRowsByKey = new Map<string, SourceRow>();

  function recordRow(
    api: ApiRow,
    bucket: WalkStat,
    scope: {
      state: string;
      county: string | null;
      city: string | null;
    },
  ): void {
    bucket.walked++;
    const ep = (api.endpoint_url ?? "").trim();
    if (!ep.startsWith("http")) {
      bucket.dropNoUrl++;
      return;
    }
    if (isForeignDomain(ep)) {
      bucket.dropForeign++;
      return;
    }
    const row = adaptApi({
      api,
      state: scope.state,
      city: scope.city,
      county: scope.county,
    });
    if (!row) {
      // adaptApi returned null after the foreign + URL checks above —
      // therefore the rejection was the relevance filter.
      bucket.dropIrrelevant++;
      return;
    }
    bucket.kept++;
    if (row.enabled) bucket.enabled++;
    // Dedup on source_key — first writer wins, but we prefer the
    // most-specific scope (city > county > state > federal). Walk order
    // below is city → county → state → federal so first-write-wins
    // already enforces this.
    if (!allRowsByKey.has(row.source_key)) {
      allRowsByKey.set(row.source_key, row);
    }
  }

  console.log("\nphase 1: walking APIs ...");

  const byState = data.by_state ?? {};

  // City level first → most-specific scope wins on dedup.
  for (const stCode of Object.keys(byState)) {
    const st = byState[stCode];
    const stateCode = (stCode || "").toUpperCase();
    const counties = st.counties ?? {};
    for (const cnKey of Object.keys(counties)) {
      const county = counties[cnKey];
      // Synthetic county "_unmatched_cities" buckets cities whose county
      // we couldn't disambiguate — strip the leading underscore for
      // jurisdiction display.
      const isUnmatched = cnKey.startsWith("_");
      const countyName = isUnmatched ? null : cnKey;
      const cities = county.cities ?? {};
      for (const ctKey of Object.keys(cities)) {
        const apis = cityApis(cities[ctKey]);
        for (const api of apis) {
          recordRow(api, stat.city, {
            state: stateCode,
            county: countyName,
            city: ctKey,
          });
        }
      }
    }
  }

  // County level
  for (const stCode of Object.keys(byState)) {
    const st = byState[stCode];
    const stateCode = (stCode || "").toUpperCase();
    const counties = st.counties ?? {};
    for (const cnKey of Object.keys(counties)) {
      const isUnmatched = cnKey.startsWith("_");
      if (isUnmatched) continue; // county-level for an unmatched bucket is meaningless
      const county = counties[cnKey];
      for (const api of county.county_level ?? []) {
        recordRow(api, stat.county, {
          state: stateCode,
          county: cnKey,
          city: null,
        });
      }
    }
  }

  // State level
  for (const stCode of Object.keys(byState)) {
    const st = byState[stCode];
    const stateCode = (stCode || "").toUpperCase();
    for (const api of st.state_level ?? []) {
      recordRow(api, stat.state, {
        state: stateCode,
        county: null,
        city: null,
      });
    }
  }

  // Federal — `national_federal` is a flat array in this catalog.
  for (const api of data.national_federal ?? []) {
    recordRow(api, stat.federal, {
      state: "US",
      county: null,
      city: null,
    });
  }

  console.log(
    "\nwalk stats:\n" +
      `  federal: walked=${stat.federal.walked.toLocaleString()}, kept=${stat.federal.kept.toLocaleString()}, enabled=${stat.federal.enabled.toLocaleString()}, dropIrrelevant=${stat.federal.dropIrrelevant.toLocaleString()}, dropForeign=${stat.federal.dropForeign}, dropNoUrl=${stat.federal.dropNoUrl}\n` +
      `  state  : walked=${stat.state.walked.toLocaleString()}, kept=${stat.state.kept.toLocaleString()}, enabled=${stat.state.enabled.toLocaleString()}, dropIrrelevant=${stat.state.dropIrrelevant.toLocaleString()}, dropForeign=${stat.state.dropForeign}, dropNoUrl=${stat.state.dropNoUrl}\n` +
      `  county : walked=${stat.county.walked.toLocaleString()}, kept=${stat.county.kept.toLocaleString()}, enabled=${stat.county.enabled.toLocaleString()}, dropIrrelevant=${stat.county.dropIrrelevant.toLocaleString()}, dropForeign=${stat.county.dropForeign}, dropNoUrl=${stat.county.dropNoUrl}\n` +
      `  city   : walked=${stat.city.walked.toLocaleString()}, kept=${stat.city.kept.toLocaleString()}, enabled=${stat.city.enabled.toLocaleString()}, dropIrrelevant=${stat.city.dropIrrelevant.toLocaleString()}, dropForeign=${stat.city.dropForeign}, dropNoUrl=${stat.city.dropNoUrl}\n`,
  );

  let allRows = [...allRowsByKey.values()];
  console.log(
    `total unique rows: ${allRows.length.toLocaleString()} (deduped on source_key)`,
  );
  const enabledCount = allRows.filter((r) => r.enabled).length;
  console.log(
    `  enabled=true (verified-live): ${enabledCount.toLocaleString()} (${((enabledCount / Math.max(1, allRows.length)) * 100).toFixed(1)}%)`,
  );

  // State distribution preview (top 10).
  const stateCount = new Map<string, number>();
  for (const r of allRows) {
    stateCount.set(r.state, (stateCount.get(r.state) ?? 0) + 1);
  }
  const topStates = [...stateCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log("\nTop 10 states in the upcoming upsert:");
  for (const [st, c] of topStates) {
    console.log(`  ${st}: ${c.toLocaleString()}`);
  }

  if (HARD_LIMIT > 0) {
    allRows = allRows.slice(0, HARD_LIMIT);
    console.log(`\n[IMPORT_LIMIT=${HARD_LIMIT}] capping`);
  }

  /* ── Baseline counts (before upsert) ───────────────────────────── */
  const { count: beforeTotal } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  const { count: beforeEnabled } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `\nbaseline: permit_sources total=${beforeTotal?.toLocaleString() ?? "?"}, enabled=${beforeEnabled?.toLocaleString() ?? "?"}`,
  );

  console.log(`\nupserting ${allRows.length.toLocaleString()} rows ...`);
  const upsertRes = await upsertBatch("verified_master_json", allRows);
  console.log(
    `\n[verified_master_json] +${upsertRes.ok.toLocaleString()} ok, ${upsertRes.err} errors`,
  );

  /* ── Final summary ─────────────────────────────────────────────── */

  const totalWalked =
    stat.federal.walked +
    stat.state.walked +
    stat.county.walked +
    stat.city.walked;
  const totalKept =
    stat.federal.kept +
    stat.state.kept +
    stat.county.kept +
    stat.city.kept;
  const totalDropForeign =
    stat.federal.dropForeign +
    stat.state.dropForeign +
    stat.county.dropForeign +
    stat.city.dropForeign;
  const totalDropIrrelevant =
    stat.federal.dropIrrelevant +
    stat.state.dropIrrelevant +
    stat.county.dropIrrelevant +
    stat.city.dropIrrelevant;
  const totalDropNoUrl =
    stat.federal.dropNoUrl +
    stat.state.dropNoUrl +
    stat.county.dropNoUrl +
    stat.city.dropNoUrl;

  console.log("\n=== SUMMARY ===");
  console.log(`Total APIs walked         : ${totalWalked.toLocaleString()}`);
  console.log(`Dropped (no http URL)     : ${totalDropNoUrl.toLocaleString()}`);
  console.log(`Dropped (foreign domain)  : ${totalDropForeign.toLocaleString()}`);
  console.log(
    `Dropped (not permit-rel.) : ${totalDropIrrelevant.toLocaleString()}`,
  );
  console.log(`Total kept (relevant)     : ${totalKept.toLocaleString()}`);
  console.log(`Unique source_keys        : ${allRowsByKey.size.toLocaleString()}`);
  console.log(`  -> enabled=true         : ${enabledCount.toLocaleString()}`);
  console.log(
    `Upserted permit_sources   : ${upsertRes.ok.toLocaleString()} ok, ${upsertRes.err} errors`,
  );

  console.log("\nTop 5 states by source count:");
  const top5 = [...stateCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [st, c] of top5) {
    console.log(`  ${st}: ${c.toLocaleString()}`);
  }

  // Final diff vs baseline.
  const { count: afterTotal } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  const { count: afterEnabled } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `\npermit_sources after: total=${afterTotal?.toLocaleString() ?? "?"} (delta=${((afterTotal ?? 0) - (beforeTotal ?? 0)).toLocaleString()}), enabled=${afterEnabled?.toLocaleString() ?? "?"} (delta=${((afterEnabled ?? 0) - (beforeEnabled ?? 0)).toLocaleString()})`,
  );

  console.log("\ndone.");
})();
