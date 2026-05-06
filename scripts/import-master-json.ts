/**
 * Import the new US_COMPREHENSIVE_MASTER.json catalog (v3.2_REFERENCED)
 * into `permit_sources` AND populate `permit_source_zips` with the
 * explicit ZIP→source coverage map.
 *
 * Why this matters:
 *   The CSV import (import-desktop-catalogs.ts) gave us ~107k rows of
 *   permit-source candidates — but no way to answer "which APIs cover
 *   ZIP 90210?" without scanning every row. The JSON variant of the same
 *   catalog provides the explicit `zip_index` mapping so we can answer
 *   that question with a single composite-key lookup. This is the
 *   GAME-CHANGER for the lead-router: city > county > state > federal
 *   priority is now a single SQL query.
 *
 * File:
 *   C:/Users/yabis/Desktop/US_COMPREHENSIVE_MASTER.json (~98 MB)
 *
 * Schema (per the file's metadata block):
 *   metadata: { schema_version, total_zips, total_apis, ... }
 *   national_federal: { permits[], sold_properties[], insurance_claims[], all_apis[] }
 *   states: { ST: { state_apis[], counties: { CT: { county_apis[], cities: { CITY: { city_apis[] } } } } } }
 *   territories: same shape as states
 *   zip_index: { ZIP: { state, county, city, ... lookup paths } }
 *
 * API row shape (uniform across federal/state/county/city):
 *   { source_name, data_type, endpoint_url, platform, format, permit_categories, notes }
 *
 * What this script does:
 *   1. Walk federal permits, state_apis, county_apis, city_apis.
 *   2. Filter via the same isPermitRelevant() heuristic from
 *      import-desktop-catalogs.ts so film/marriage/marijuana/etc. drop
 *      out.
 *   3. Build canonical SourceRow with discoveredVia="us_master_json".
 *   4. Bulk-upsert into permit_sources (idempotent on source_key).
 *      Graceful-degrade when migration 00052 isn't applied yet (strip
 *      provenance columns and retry).
 *   5. Phase 2: walk zip_index, cross-reference with state/county/city
 *      sources, emit (source_key, zip, granularity) into
 *      permit_source_zips. Federal sources fan out to every ZIP.
 *      Graceful-degrade on 42P01 (table missing) → log + skip.
 *
 * Memory budget: JSON.parse on 98MB allocates ~400MB heap. Run with
 *   NODE_OPTIONS=--max-old-space-size=2048 if needed (the pnpm script
 *   sets this).
 *
 * Idempotent. Re-running widens coverage but never duplicates.
 *
 * Usage:
 *   pnpm import:master-json
 *   IMPORT_LIMIT=2000 pnpm import:master-json   # smoke-test cap
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

// User reorganized desktop in this session. Probe both known locations
// at runtime so re-runs survive desktop reshuffles.
const JSON_CANDIDATES = [
  "C:/Users/yabis/Desktop/US_COMPREHENSIVE_MASTER.json",
  "C:/Users/yabis/Desktop/Data Henri 3/US_COMPREHENSIVE_MASTER.json",
  "C:/Users/yabis/Desktop/henri data/US_COMPREHENSIVE_MASTER.json",
];
const JSON_PATH = JSON_CANDIDATES.find((p) => fs.existsSync(p)) ?? JSON_CANDIDATES[0];

/* ── Helpers copied verbatim from import-desktop-catalogs.ts ──────── */

function slug(v: string): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function platformFromUrl(
  url: string,
): "arcgis" | "socrata" | "ckan" | "csv" | "unknown" {
  const u = (url ?? "").toLowerCase();
  if (
    u.includes("arcgis.com") ||
    u.includes("/arcgis/rest/services") ||
    u.includes("featureserver")
  )
    return "arcgis";
  if (/\/resource\/[a-z0-9-]+\.json/.test(u)) return "socrata";
  if (/\/api\/views\//.test(u)) return "socrata";
  if (/data\.[^/]+\.(gov|org|us|com)\/data\.json$/.test(u)) return "ckan";
  if (u.endsWith(".csv") || u.includes("/datastore/dump/")) return "csv";
  return "unknown";
}

function normPlatform(
  raw: string,
): "arcgis" | "socrata" | "ckan" | "csv" | "unknown" | "" {
  const low = (raw ?? "").toLowerCase().trim();
  if (low.includes("arcgis hub")) return "arcgis";
  if (low.includes("arcgis")) return "arcgis";
  if (low.includes("socrata")) return "socrata";
  if (low.includes("ckan")) return "ckan";
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

/* ── Canonical row factory (verbatim shape, extended discovery enum) ── */

type DiscoveredVia = "us_master_csv" | "nationwide_csv" | "us_master_json";
type SourceType = "arcgis" | "socrata" | "ckan" | "csv" | "unknown";

type SourceRow = {
  source_key: string;
  name: string;
  state: string;
  city: string | null;
  jurisdiction: string | null;
  endpoint: string;
  source_type: SourceType;
  auth: string;
  enabled: boolean;
  discovered_via: DiscoveredVia;
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
  return `${platform}:${state}:${slug(city ?? "")}:${slug(name)}:${epHash}`.slice(
    0,
    200,
  );
}

function mkRow(partial: {
  platform: SourceType;
  state: string;
  name: string;
  endpoint: string;
  city?: string | null;
  jurisdiction?: string | null;
  notes?: string | null;
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
    enabled: false,
    discovered_via: partial.discoveredVia,
    field_mapping_status: "unknown",
    imported_at: new Date().toISOString(),
    notes: (partial.notes ?? null)?.toString().slice(0, 1000) ?? null,
  };
}

/* ── Bulk upsert with stripProvenance fallback ─────────────────────── */

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

let provenanceMissing = false; // sticky once detected

/**
 * Upsert a single chunk, retrying on statement-timeout by halving the
 * chunk and re-trying recursively. Supabase's default statement_timeout
 * for the service-role connection pooler is ~8s; large 500-row upserts
 * with idempotent collisions can blow past that. Halving down to ~50
 * rows gets us under the budget without manual tuning.
 */
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
    `  [${label}] chunk size=${chunk.length} failed: ${error.code ?? "?"} ${msg}`,
  );
  return { ok: 0, err: chunk.length };
}

/* Resumable checkpoint — Supabase 522s on big bulk imports leave the
 * upsert in a half-done state. Without a checkpoint file each retry
 * re-uploads from row 0, wasting hours. We persist the highest-completed
 * batch index after every successful chunk so re-runs skip ahead. The
 * source_key dedup still protects correctness if the checkpoint is
 * stale. */
const STATE_PATH = path.resolve(
  process.cwd(),
  "scripts",
  ".import-master-json.state.json",
);

interface ImportState {
  /** Last successfully-completed batch start index (inclusive cursor). */
  cursor: number;
  /** Rolling tally across resumes, for the final summary. */
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
    // best-effort — never fail the import on a checkpoint write
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
  // Smaller initial batch to stay well under Supabase's statement_timeout
  // for the service role. The retry path (upsertChunkWithRetry) halves
  // further on timeout.
  const BATCH = 200;
  const FRESH = process.env.FRESH === "1";

  // Resume from checkpoint unless FRESH=1 was passed.
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
    // Log every ~10 batches.
    if ((i / BATCH) % 10 === 0) {
      console.log(
        `  [${label}] ${ok.toLocaleString()} / ${rows.length.toLocaleString()} (errs=${err})`,
      );
    }
  }
  // Done — clear the checkpoint so the next run starts clean.
  clearState();
  return { ok, err };
}

/* ── JSON shape (loose; we don't fight the upstream casing) ───────── */

type ApiRow = {
  source_name?: string;
  data_type?: string;
  endpoint_url?: string;
  platform?: string;
  format?: string;
  permit_categories?: string;
  notes?: string;
};

type CityNode = {
  zip_codes?: string[];
  city_apis?: ApiRow[];
};

type CountyNode = {
  name?: string;
  county_apis?: ApiRow[];
  cities?: Record<string, CityNode>;
};

type StateNode = {
  code?: string;
  name?: string;
  state_apis?: ApiRow[];
  counties?: Record<string, CountyNode>;
};

type ZipIndexEntry = {
  state?: string;
  county?: string;
  city?: string;
};

type MasterJson = {
  metadata?: Record<string, unknown>;
  national_federal?: {
    permits?: ApiRow[];
    sold_properties?: ApiRow[];
    insurance_claims?: ApiRow[];
    all_apis?: ApiRow[];
  };
  states?: Record<string, StateNode>;
  territories?: Record<string, StateNode>;
  zip_index?: Record<string, ZipIndexEntry>;
};

/* ── Build SourceRow from an ApiRow + scope context ───────────────── */

function adaptApi(opts: {
  api: ApiRow;
  state: string; // "US" for federal
  city: string | null;
  county: string | null;
}): SourceRow | null {
  const api = opts.api;
  const name = (api.source_name ?? "").trim();
  const ep = (api.endpoint_url ?? "").trim();
  if (!ep.startsWith("http")) return null;
  // Filter on name + permit_categories + notes (same haystack pattern as
  // the CSV importer). data_type is also an honest signal here — federal
  // sold_property/insurance_claim feeds carry data_type that doesn't
  // mention "permit" but their categories do.
  const haystack = [
    name,
    api.permit_categories,
    api.notes,
    api.data_type,
  ]
    .filter(Boolean)
    .join(" | ");
  if (!isPermitRelevant(haystack)) return null;
  const platform = normPlatform(api.platform ?? "") || platformFromUrl(ep);
  const notesParts = [
    api.permit_categories,
    api.notes,
    api.format ? `format=${api.format}` : "",
    api.data_type ? `data_type=${api.data_type}` : "",
  ].filter((s) => (s ?? "").length > 0);
  return mkRow({
    platform,
    state: opts.state,
    name,
    endpoint: ep,
    city: opts.city,
    jurisdiction: opts.county,
    notes: notesParts.join(" | "),
    discoveredVia: "us_master_json",
  });
}

/* ── Main ─────────────────────────────────────────────────────────── */

(async () => {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`Master JSON not found at ${JSON_PATH}`);
    process.exit(1);
  }

  console.log(`reading ${JSON_PATH} ...`);
  const t0 = Date.now();
  const raw = fs.readFileSync(JSON_PATH, "utf-8");
  console.log(
    `  read ${(raw.length / 1024 / 1024).toFixed(1)} MB in ${Date.now() - t0} ms`,
  );

  const t1 = Date.now();
  const data = JSON.parse(raw) as MasterJson;
  console.log(`  parsed in ${Date.now() - t1} ms`);

  if (data.metadata) {
    console.log("metadata:", JSON.stringify(data.metadata));
  }

  /* ── Phase 1: walk APIs at all 4 levels → permit_sources ───────── */

  type WalkStat = { walked: number; kept: number };
  const stat = {
    federal: { walked: 0, kept: 0 } as WalkStat,
    state: { walked: 0, kept: 0 } as WalkStat,
    county: { walked: 0, kept: 0 } as WalkStat,
    city: { walked: 0, kept: 0 } as WalkStat,
  };

  // Map source_key → granularity, so phase 2 can tag the link rows.
  const keyToGranularity = new Map<
    string,
    "federal" | "state" | "county" | "city"
  >();
  // Map (state) → set of source_keys (state-level)
  const stateKeys = new Map<string, Set<string>>();
  // Map (state, countyKey) → set of source_keys (county-level)
  // countyKey is the upstream JSON key (case-preserved, e.g. "Los Angeles")
  const countyKeys = new Map<string, Map<string, Set<string>>>();
  // Map (state, countyKey, cityKey) → set of source_keys (city-level)
  const cityKeys = new Map<
    string,
    Map<string, Map<string, Set<string>>>
  >();
  // Federal source_keys (apply to every ZIP)
  const federalKeys = new Set<string>();

  const allRowsByKey = new Map<string, SourceRow>();

  function recordRow(
    row: SourceRow,
    granularity: "federal" | "state" | "county" | "city",
    scope: { state: string; county: string | null; city: string | null },
  ) {
    if (!allRowsByKey.has(row.source_key)) {
      allRowsByKey.set(row.source_key, row);
    }
    // Granularity is stable per key — first-write-wins. We always walk
    // city → county → state → federal in that order below, so a key that
    // appears at multiple levels gets the most-specific one.
    if (!keyToGranularity.has(row.source_key)) {
      keyToGranularity.set(row.source_key, granularity);
    }
    if (granularity === "federal") {
      federalKeys.add(row.source_key);
    } else if (granularity === "state") {
      let bucket = stateKeys.get(scope.state);
      if (!bucket) {
        bucket = new Set<string>();
        stateKeys.set(scope.state, bucket);
      }
      bucket.add(row.source_key);
    } else if (granularity === "county" && scope.county) {
      let stateMap = countyKeys.get(scope.state);
      if (!stateMap) {
        stateMap = new Map<string, Set<string>>();
        countyKeys.set(scope.state, stateMap);
      }
      let bucket = stateMap.get(scope.county);
      if (!bucket) {
        bucket = new Set<string>();
        stateMap.set(scope.county, bucket);
      }
      bucket.add(row.source_key);
    } else if (granularity === "city" && scope.county && scope.city) {
      let stateMap = cityKeys.get(scope.state);
      if (!stateMap) {
        stateMap = new Map<string, Map<string, Set<string>>>();
        cityKeys.set(scope.state, stateMap);
      }
      let countyMap = stateMap.get(scope.county);
      if (!countyMap) {
        countyMap = new Map<string, Set<string>>();
        stateMap.set(scope.county, countyMap);
      }
      let bucket = countyMap.get(scope.city);
      if (!bucket) {
        bucket = new Set<string>();
        countyMap.set(scope.city, bucket);
      }
      bucket.add(row.source_key);
    }
  }

  // City-level first → most-specific granularity wins.
  function walkStates(
    bag: Record<string, StateNode> | undefined,
    label: string,
  ) {
    if (!bag) return;
    for (const stCode of Object.keys(bag)) {
      const st = bag[stCode];
      const stateCode = (st.code || stCode || "").toUpperCase();
      // City level
      for (const cn of Object.keys(st.counties ?? {})) {
        const county = st.counties![cn];
        for (const ct of Object.keys(county.cities ?? {})) {
          const city = county.cities![ct];
          for (const api of city.city_apis ?? []) {
            stat.city.walked++;
            const row = adaptApi({
              api,
              state: stateCode,
              city: ct,
              county: cn,
            });
            if (row) {
              stat.city.kept++;
              recordRow(row, "city", {
                state: stateCode,
                county: cn,
                city: ct,
              });
            }
          }
        }
      }
      // County level
      for (const cn of Object.keys(st.counties ?? {})) {
        const county = st.counties![cn];
        for (const api of county.county_apis ?? []) {
          stat.county.walked++;
          const row = adaptApi({
            api,
            state: stateCode,
            city: null,
            county: cn,
          });
          if (row) {
            stat.county.kept++;
            recordRow(row, "county", {
              state: stateCode,
              county: cn,
              city: null,
            });
          }
        }
      }
      // State level
      for (const api of st.state_apis ?? []) {
        stat.state.walked++;
        const row = adaptApi({
          api,
          state: stateCode,
          city: null,
          county: null,
        });
        if (row) {
          stat.state.kept++;
          recordRow(row, "state", {
            state: stateCode,
            county: null,
            city: null,
          });
        }
      }
    }
    void label;
  }

  console.log("\nphase 1: walking APIs ...");
  walkStates(data.states, "states");
  walkStates(data.territories, "territories");

  // Federal — drive off `permits` only (not all_apis, which is a superset
  // including sold_properties + insurance_claims that aren't construction
  // permits). Sold_properties and insurance_claims are intentionally
  // dropped: they're useful enrichment feeds but Henri's permit pipeline
  // only consumes construction-permit endpoints.
  for (const api of data.national_federal?.permits ?? []) {
    stat.federal.walked++;
    const row = adaptApi({
      api,
      state: "US",
      city: null,
      county: null,
    });
    if (row) {
      stat.federal.kept++;
      recordRow(row, "federal", { state: "US", county: null, city: null });
    }
  }

  console.log(
    "\nwalk stats:\n" +
      `  federal: walked=${stat.federal.walked.toLocaleString()}, kept=${stat.federal.kept.toLocaleString()}\n` +
      `  state  : walked=${stat.state.walked.toLocaleString()}, kept=${stat.state.kept.toLocaleString()}\n` +
      `  county : walked=${stat.county.walked.toLocaleString()}, kept=${stat.county.kept.toLocaleString()}\n` +
      `  city   : walked=${stat.city.walked.toLocaleString()}, kept=${stat.city.kept.toLocaleString()}\n`,
  );

  let allRows = [...allRowsByKey.values()];
  console.log(
    `total unique rows: ${allRows.length.toLocaleString()} (deduped on source_key)`,
  );

  // Per-state breakdown of what we're about to import (top 10 states).
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

  console.log(`\nupserting ${allRows.length.toLocaleString()} rows ...`);
  const upsertRes = await upsertBatch("us_master_json", allRows);
  console.log(
    `\n[us_master_json] +${upsertRes.ok.toLocaleString()} ok, ${upsertRes.err} errors`,
  );

  /* ── Phase 2: populate permit_source_zips ──────────────────────── */
  //
  // Memory budget note: a naive "build all links into one Set, then
  // upsert in batches" approach blows up at ~16M entries (Node's max
  // Set size). With 33,305 ZIPs × ~10 sources/ZIP × federal fan-out
  // we'd be at 300M+ pairs. Instead we stream: build a small in-memory
  // buffer, flush to Postgres, clear, repeat. Dedup happens at the DB
  // via the composite primary key (source_key, zip). The JS side does
  // a per-ZIP dedup only (a small, bounded set per ZIP).

  console.log("\nphase 2: building ZIP→source links (streaming) ...");
  const zipIndex = data.zip_index ?? {};
  const zips = Object.keys(zipIndex);
  console.log(`  ${zips.length.toLocaleString()} ZIPs in zip_index`);

  type ZipLink = { source_key: string; zip: string; granularity: string };

  // Probe the table. Distinguishes three cases:
  //   1. table exists — proceed with Phase 2
  //   2. PostgREST schema cache is stale — table actually exists in
  //      Postgres but the REST proxy hasn't refreshed. Workaround: hit
  //      pg_tables directly via an RPC, OR (simpler) attempt a tiny
  //      insert and let the actual database enforce the schema.
  //   3. table genuinely missing — migration 00053 not applied
  //
  // Earlier versions of this probe also bailed on stale-cache errors
  // ("Could not find the table 'public.permit_source_zips' in the
  // schema cache") which made Phase 2 silently skip even though the
  // table existed. Now we only bail on the specific 42P01 code or the
  // explicit "relation X does not exist" text — both of which are
  // generated by Postgres itself, not by PostgREST's schema cache.
  const probe = await s
    .from("permit_source_zips")
    .select("zip")
    .limit(1);
  let zipTableMissing = false;
  if (probe.error) {
    const msg = probe.error.message ?? "";
    const realTableMissing =
      probe.error.code === "42P01" ||
      /relation ".*" does not exist/i.test(msg);
    const staleCache =
      probe.error.code === "PGRST205" ||
      /could not find the table .* in the schema cache/i.test(msg) ||
      /schema cache/i.test(msg);

    if (realTableMissing) {
      zipTableMissing = true;
      console.warn(
        "  [permit_source_zips] table missing — migration 00053 not yet applied. Skipping phase 2.",
      );
      console.warn("  Re-run after applying migration to populate.");
    } else if (staleCache) {
      // Force a schema reload via NOTIFY (only works if exec_sql RPC is
      // present), then retry the probe. If both fail, push ahead with
      // the upsert anyway — Postgres's own DDL is the ultimate source
      // of truth, and the upsert path will surface a real error if the
      // table is genuinely missing.
      console.log(
        "  [permit_source_zips] stale schema cache — forcing reload + retry",
      );
      try {
        // PostgREST listens on NOTIFY pgrst, 'reload schema'.
        await s.rpc("exec_sql", { sql: "NOTIFY pgrst, 'reload schema';" });
      } catch {
        // exec_sql RPC may not be installed; fall through.
      }
      await new Promise((r) => setTimeout(r, 2000));
      const retry = await s.from("permit_source_zips").select("zip").limit(1);
      if (retry.error) {
        const m2 = retry.error.message ?? "";
        if (
          retry.error.code === "42P01" ||
          /relation ".*" does not exist/i.test(m2)
        ) {
          zipTableMissing = true;
          console.warn(
            "  [permit_source_zips] retry confirmed table missing — skipping phase 2",
          );
        } else {
          console.warn(
            `  [permit_source_zips] retry inconclusive (${retry.error.code ?? "?"}); attempting upsert anyway`,
          );
        }
      }
    } else {
      console.warn(
        `  [permit_source_zips] probe failed: ${probe.error.code ?? "?"} ${msg}`,
      );
    }
  }

  let zipOk = 0;
  let zipErr = 0;
  let totalLinksBuilt = 0;
  const ZIP_BATCH = 500;
  // Tiny per-buffer dedup so we don't ship the same (key,zip) twice in
  // one network call. The buffer caps at 4×ZIP_BATCH to bound memory.
  const buffer: ZipLink[] = [];
  const bufferSeen = new Set<string>();
  function bufPush(source_key: string, zip: string, granularity: string) {
    const lk = `${source_key}\u0001${zip}`;
    if (bufferSeen.has(lk)) return;
    bufferSeen.add(lk);
    buffer.push({ source_key, zip, granularity });
    totalLinksBuilt++;
  }

  type ZipChunkResult =
    | { ok: number; err: number }
    | { tableMissing: true };

  async function upsertZipChunk(
    chunk: ZipLink[],
    depth: number,
  ): Promise<ZipChunkResult> {
    if (chunk.length === 0) return { ok: 0, err: 0 };
    const { error } = await s
      .from("permit_source_zips")
      .upsert(chunk, {
        onConflict: "source_key,zip",
        ignoreDuplicates: true,
      });
    if (!error) return { ok: chunk.length, err: 0 };
    const msg = error.message ?? "";
    const tableMissing =
      error.code === "42P01" ||
      /relation .* does not exist/i.test(msg) ||
      /could not find the table/i.test(msg);
    if (tableMissing) return { tableMissing: true };
    const fkViolation =
      error.code === "23503" || /foreign key/i.test(msg);
    if (fkViolation) {
      // Bisect — not all rows are bad, just some keys missing.
      if (chunk.length === 1) return { ok: 0, err: 1 };
      const mid = Math.floor(chunk.length / 2);
      const a = await upsertZipChunk(chunk.slice(0, mid), depth + 1);
      if ("tableMissing" in a) return a;
      const b = await upsertZipChunk(chunk.slice(mid), depth + 1);
      if ("tableMissing" in b) return b;
      return { ok: a.ok + b.ok, err: a.err + b.err };
    }
    const isTimeout =
      error.code === "57014" ||
      /statement timeout/i.test(msg) ||
      /canceling statement/i.test(msg);
    if (isTimeout && chunk.length > 50 && depth < 6) {
      const mid = Math.floor(chunk.length / 2);
      const a = await upsertZipChunk(chunk.slice(0, mid), depth + 1);
      if ("tableMissing" in a) return a;
      const b = await upsertZipChunk(chunk.slice(mid), depth + 1);
      if ("tableMissing" in b) return b;
      return { ok: a.ok + b.ok, err: a.err + b.err };
    }
    console.warn(
      `  [permit_source_zips] chunk size=${chunk.length} failed: ${error.code ?? "?"} ${msg}`,
    );
    return { ok: 0, err: chunk.length };
  }

  /** Flush the current `buffer` to Postgres. Resets the dedup set so
   *  the next batch starts fresh. */
  async function flushBuffer(): Promise<void> {
    if (zipTableMissing || buffer.length === 0) {
      buffer.length = 0;
      bufferSeen.clear();
      return;
    }
    const chunk = buffer.slice();
    buffer.length = 0;
    bufferSeen.clear();
    const r = await upsertZipChunk(chunk, 0);
    if ("tableMissing" in r) {
      zipTableMissing = true;
      console.warn(
        "  [permit_source_zips] table missing mid-flight — stopping phase 2.",
      );
      return;
    }
    zipOk += r.ok;
    zipErr += r.err;
  }

  if (!zipTableMissing) {
    let zipsProcessed = 0;
    for (const zip of zips) {
      if (zipTableMissing) break;
      if (!/^\d{5}$/.test(zip)) continue; // schema constraint
      const entry = zipIndex[zip];
      if (!entry) continue;
      const stateCode = (entry.state ?? "").toUpperCase();
      const countyName = entry.county ?? "";
      const cityName = entry.city ?? "";
      // Federal — every ZIP gets every federal source.
      for (const fk of federalKeys) {
        bufPush(fk, zip, "federal");
      }
      // State
      const sb = stateKeys.get(stateCode);
      if (sb) for (const sk of sb) bufPush(sk, zip, "state");
      // County
      const cmap = countyKeys.get(stateCode);
      if (cmap && countyName) {
        const cb = cmap.get(countyName);
        if (cb) for (const sk of cb) bufPush(sk, zip, "county");
      }
      // City
      const cityMap = cityKeys.get(stateCode);
      if (cityMap && countyName && cityName) {
        const ctyMap = cityMap.get(countyName);
        if (ctyMap) {
          const ctb = ctyMap.get(cityName);
          if (ctb) for (const sk of ctb) bufPush(sk, zip, "city");
        }
      }
      // Flush whenever the buffer crosses 4×ZIP_BATCH so memory stays
      // bounded regardless of the federal/state fan-out. This also
      // gives Supabase steady throughput rather than one giant blast.
      if (buffer.length >= ZIP_BATCH * 4) {
        await flushBuffer();
      }
      zipsProcessed++;
      if (zipsProcessed % 5000 === 0) {
        console.log(
          `  [zips] processed ${zipsProcessed.toLocaleString()}/${zips.length.toLocaleString()} ZIPs · upserted ${zipOk.toLocaleString()} (errs=${zipErr})`,
        );
      }
    }
    // Flush the remainder.
    await flushBuffer();
    console.log(
      `  built ${totalLinksBuilt.toLocaleString()} (source_key, zip) link rows total`,
    );
  }

  /* ── Final summary ─────────────────────────────────────────────── */

  console.log("\n=== SUMMARY ===");
  const totalWalked =
    stat.federal.walked +
    stat.state.walked +
    stat.county.walked +
    stat.city.walked;
  const totalKept =
    stat.federal.kept + stat.state.kept + stat.county.kept + stat.city.kept;
  console.log(`Total APIs walked     : ${totalWalked.toLocaleString()}`);
  console.log(`Total kept (relevant) : ${totalKept.toLocaleString()}`);
  console.log(
    `Unique source_keys    : ${allRowsByKey.size.toLocaleString()}`,
  );
  console.log(
    `Upserted permit_sources: ${upsertRes.ok.toLocaleString()} ok, ${upsertRes.err} errors`,
  );
  if (zipTableMissing) {
    console.log(
      `Phase 2 ZIP links     : SKIPPED (migration 00053 not applied)`,
    );
  } else {
    console.log(
      `Phase 2 ZIP links     : ${zipOk.toLocaleString()} ok, ${zipErr} errors (of ${totalLinksBuilt.toLocaleString()} built)`,
    );
  }

  console.log("\nTop 5 states by source count:");
  const top5 = [...stateCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [st, c] of top5) {
    console.log(`  ${st}: ${c.toLocaleString()}`);
  }

  // Final row count in permit_sources, for sanity.
  const { count: totalCount } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  console.log(
    `\npermit_sources now has ${totalCount?.toLocaleString() ?? "?"} rows total`,
  );

  console.log("\ndone.");
})();
