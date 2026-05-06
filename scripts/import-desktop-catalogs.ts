/**
 * Import the two new desktop research CSVs into `permit_sources`:
 *
 *   1. C:/Users/yabis/Desktop/US_COMPREHENSIVE_MASTER.csv (~106k rows)
 *      Columns: State,City,County,Source_Platform,Dataset_Name,
 *               API_Endpoint,Format,Permit_Categories,Notes
 *      Most rows are tagged "Building Permits" but are actually GIS
 *      overlays (address points, opportunity zones, parcels). We filter
 *      aggressively on the dataset name + notes to keep only construction-
 *      adjacent endpoints.
 *
 *   2. C:/Users/yabis/Desktop/nationwide_permit_apis.csv (~6.4k rows)
 *      Columns: Source,Name,Domain,Updated At,URL,API Endpoint
 *      Curated Socrata + ArcGIS Hub permit endpoints — high signal.
 *      We still filter out film / parade / marriage / firearm permits
 *      because Henri is a construction lead-gen tool.
 *
 * Same shape contract as scripts/import-onsite-catalogs.ts:
 *   - Idempotent via source_key UPSERT (re-running is safe).
 *   - Everything lands enabled=false. Promote with bulk-probe-sources.ts
 *     once the importer reports row counts you trust.
 *   - Tags discovered_via so a later re-import / cleanup can target
 *     just rows from this batch.
 *
 * Usage:
 *   npx tsx scripts/import-desktop-catalogs.ts
 *   IMPORT_LIMIT=2000 npx tsx scripts/import-desktop-catalogs.ts   # cap each adapter
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR  = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

/* ── CSV parser (quote-aware, multi-line tolerant) ────────────────────
 *
 * The Notes column in US_COMPREHENSIVE_MASTER is a quoted field that
 * contains commas; the simpler line-by-line parser in
 * import-onsite-catalogs.ts handles that. The newline-aware version below
 * also tolerates `"` inside quoted fields by walking a single character
 * stream rather than splitting on newlines first. */

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"' && raw[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n" || c === "\r") {
        // Treat \r\n as a single break.
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
    header.forEach((h, idx) => { obj[h] = (cells[idx] ?? "").trim(); });
    out.push(obj);
  }
  return out;
}

/* ── Normalizers ──────────────────────────────────────────────────── */

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
  if (up === "NATIONWIDE" || up === "USA" || up === "US") return "";
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

function platformFromUrl(url: string): "arcgis" | "socrata" | "ckan" | "csv" | "unknown" {
  const u = (url ?? "").toLowerCase();
  if (u.includes("arcgis.com") || u.includes("/arcgis/rest/services") || u.includes("featureserver")) return "arcgis";
  if (/\/resource\/[a-z0-9-]+\.json/.test(u)) return "socrata";
  if (/\/api\/views\//.test(u)) return "socrata";
  if (/data\.[^/]+\.(gov|org|us|com)\/data\.json$/.test(u)) return "ckan";
  if (u.endsWith(".csv") || u.includes("/datastore/dump/")) return "csv";
  return "unknown";
}

function normPlatform(raw: string): "arcgis" | "socrata" | "ckan" | "csv" | "unknown" | "" {
  const low = (raw ?? "").toLowerCase().trim();
  if (low.includes("arcgis hub")) return "arcgis";
  if (low.includes("arcgis")) return "arcgis";
  if (low.includes("socrata")) return "socrata";
  if (low.includes("ckan")) return "ckan";
  return "";
}

/* ── Permit-relevance filter ─────────────────────────────────────────
 *
 * Henri sells construction-trade leads. A "Building Permits" tag in an
 * upstream catalog is a hint, not a guarantee — many tagged datasets
 * are address points, opportunity zones, business licenses, etc. And
 * the catalogs do include permits we DO NOT want (film permits, parade
 * permits, marijuana permits, firearm permits, marriage licenses).
 *
 * The filter returns true ONLY if the haystack contains a positive
 * keyword AND no negative keyword. Negative wins on tie. */
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
  "huntinng", // tolerate the typo
  "dog license", "pet license", "burn permit", "fire permit",
  "block party", "garage sale", "vendor", "food truck",
  "noise variance", "special event", "outdoor event", "tobacco",
  "pesticide", "marriages",
];

function isPermitRelevant(...fields: (string | undefined)[]): boolean {
  const haystack = fields
    .map((f) => (f ?? "").toLowerCase())
    .join(" ");
  if (haystack.length === 0) return false;
  // Negative wins.
  for (const n of NEGATIVE) {
    if (haystack.includes(n.toLowerCase())) return false;
  }
  for (const p of POSITIVE) {
    if (haystack.includes(p.toLowerCase())) return true;
  }
  return false;
}

/* ── Domain → state inference for Socrata rows ────────────────────── */

const DOMAIN_TO_STATE: Record<string, string> = {
  "data.cityofchicago.org": "IL",
  "data.cityofnewyork.us": "NY",
  "data.ny.gov": "NY",
  "datahub.austintexas.gov": "TX",
  "data.texas.gov": "TX",
  "data.cityofdallas.gov": "TX",
  "data.fortworthtexas.gov": "TX",
  "data.lacity.org": "CA",
  "data.sfgov.org": "CA",
  "data.cityofsacramento.org": "CA",
  "data.sandiego.gov": "CA",
  "data.nola.gov": "LA",
  "data.norfolk.gov": "VA",
  "data.cityoforlando.net": "FL",
  "data.cityofgainesville.org": "FL",
  "data.miamigov.com": "FL",
  "data.tampagov.net": "FL",
  "data.kingcounty.gov": "WA",
  "data.cityofpasco.us": "WA",
  "cos-data.seattle.gov": "WA",
  "data.seattle.gov": "WA",
  "data.colorado.gov": "CO",
  "data.dallascityhall.com": "TX",
  "data.austintexas.gov": "TX",
  "data.cambridgema.gov": "MA",
  "data.boston.gov": "MA",
  "data.cityofboston.gov": "MA",
  "opendata.maryland.gov": "MD",
  "data.montgomerycountymd.gov": "MD",
  "opendata.utah.gov": "UT",
  "data.utah.gov": "UT",
  "citydata.mesaaz.gov": "AZ",
  "data.phoenix.gov": "AZ",
  "data.cityofevanston.org": "IL",
  "data.cityofdetroit.gov": "MI",
  "data.detroitmi.gov": "MI",
  "data.michigan.gov": "MI",
  "data.cityofnewark.us": "NJ",
  "data.nj.gov": "NJ",
  "data.cityofcharlotte.gov": "NC",
  "data.charlottenc.gov": "NC",
  "data.raleighnc.gov": "NC",
  "internal.open.piercecountywa.gov": "WA",
  "data.bayareametro.gov": "CA",
  "data.cityofberkeley.info": "CA",
  "data.cityofpaloalto.org": "CA",
  "highways.hidot.hawaii.gov": "HI",
  "data.hawaii.gov": "HI",
  "transparency.cityofnewyork.us": "NY",
  "www.transparentrichmond.org": "VA",
  "data.cincinnati-oh.gov": "OH",
  "data.cincinnatioh.gov": "OH",
  "data.cityofcleveland.gov": "OH",
  "data.maine.gov": "ME",
  "data.connecticut.gov": "CT",
  "data.ct.gov": "CT",
  "data.bloomington.in.gov": "IN",
  "data.indianapolis.in.gov": "IN",
  "mydata.iowa.gov": "IA",
  "data.iowa.gov": "IA",
  "data.kcmo.org": "MO",
  "data.stlouis-mo.gov": "MO",
  "data.kansascityks.gov": "KS",
  "data.kingstreet.gov": "DC",
  "opendata.dc.gov": "DC",
  "data.dc.gov": "DC",
};

/** Best-effort guess at state for a Socrata row whose state column is
 *  blank. We use the public-data domain as the canonical hint. Returns
 *  empty string when we genuinely don't know. */
function stateFromDomain(domain: string): string {
  const dom = (domain ?? "").toLowerCase().trim();
  if (DOMAIN_TO_STATE[dom]) return DOMAIN_TO_STATE[dom];
  // Heuristic: domains like data.cityof<city>.<state>.gov carry state in
  // the TLD position. e.g. data.cityofgainesville.org → no state.
  // Skip — too lossy.
  return "";
}

/* ── Canonical row factory ────────────────────────────────────────── */

type SourceRow = {
  source_key: string;
  name: string;
  state: string;
  city: string | null;
  jurisdiction: string | null;
  endpoint: string;
  source_type: "arcgis" | "socrata" | "ckan" | "csv" | "unknown";
  auth: string;
  enabled: boolean;
  discovered_via: "us_master_csv" | "nationwide_csv";
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

function mkRow(partial: {
  platform: SourceRow["source_type"];
  state: string;
  name: string;
  endpoint: string;
  city?: string | null;
  jurisdiction?: string | null;
  notes?: string | null;
  discoveredVia: SourceRow["discovered_via"];
}): SourceRow | null {
  const ep = (partial.endpoint ?? "").trim();
  if (!ep || !ep.startsWith("http")) return null;
  // We allow state="" for nationwide datasets (e.g. federal HUD feeds)
  // because they're real, just not state-anchored. Mark them with an
  // explicit "US" placeholder so downstream queries can still group them.
  const state = partial.state || "US";
  return {
    source_key: buildKey(partial.platform, state, partial.city ?? null, partial.name, ep),
    name: ((partial.name ?? "").slice(0, 300) || `${partial.platform} ${state}`).trim(),
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

/* ── Adapter 1: US_COMPREHENSIVE_MASTER.csv ─────────────────────── */

function adaptUsMaster(rows: Array<Record<string, string>>): {
  out: SourceRow[];
  filtered: { noState: number; notRelevant: number; badUrl: number };
} {
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const filtered = { noState: 0, notRelevant: 0, badUrl: 0 };
  for (const r of rows) {
    const state = normState(r.State || "");
    if (!state) {
      filtered.noState++;
      continue;
    }
    const dataset = r.Dataset_Name || "";
    const cats = r.Permit_Categories || "";
    const notes = r.Notes || "";
    if (!isPermitRelevant(dataset, cats, notes)) {
      filtered.notRelevant++;
      continue;
    }
    const ep = r.API_Endpoint || "";
    if (!ep.startsWith("http")) {
      filtered.badUrl++;
      continue;
    }
    const platform =
      normPlatform(r.Source_Platform || "") || platformFromUrl(ep);
    const row = mkRow({
      platform,
      state,
      name: dataset,
      endpoint: ep,
      city: r.City || null,
      jurisdiction: r.County || null,
      notes: [cats, notes].filter(Boolean).join(" | "),
      discoveredVia: "us_master_csv",
    });
    if (row && !seen.has(row.source_key)) {
      seen.add(row.source_key);
      out.push(row);
    }
  }
  return { out, filtered };
}

/* ── Adapter 2: nationwide_permit_apis.csv ───────────────────────── */

function adaptNationwide(rows: Array<Record<string, string>>): {
  out: SourceRow[];
  filtered: { notRelevant: number; badUrl: number };
} {
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const filtered = { notRelevant: 0, badUrl: 0 };
  for (const r of rows) {
    const name = r.Name || "";
    if (!isPermitRelevant(name)) {
      filtered.notRelevant++;
      continue;
    }
    const ep = r["API Endpoint"] || r.URL || "";
    if (!ep.startsWith("http")) {
      filtered.badUrl++;
      continue;
    }
    // Source column is "Socrata" or "ArcGIS Hub" — fall back to URL probe.
    const platform = normPlatform(r.Source || "") || platformFromUrl(ep);
    // State: not in this CSV. Infer from domain when possible.
    const state = stateFromDomain(r.Domain || "");
    const row = mkRow({
      platform,
      state,
      name,
      endpoint: ep,
      city: null,
      jurisdiction: null,
      notes: r.Domain ? `domain=${r.Domain}` : null,
      discoveredVia: "nationwide_csv",
    });
    if (row && !seen.has(row.source_key)) {
      seen.add(row.source_key);
      out.push(row);
    }
  }
  return { out, filtered };
}

/* ── Bulk upsert ────────────────────────────────────────────────── */

/* Strip the migration-00052 metadata columns from a row when the
 * columns aren't yet present on the live schema. This lets the importer
 * run before the migration lands; the metadata simply won't be recorded
 * (NULL on the resulting row). Detected once via a 42703 / "column does
 * not exist" error on the first batch. */
type StrippedRow = Omit<SourceRow, "discovered_via" | "field_mapping_status" | "imported_at" | "notes">;
function stripProvenance(rows: SourceRow[]): StrippedRow[] {
  return rows.map((r) => {
    const { discovered_via: _dv, field_mapping_status: _fms, imported_at: _ia, notes: _n, ...rest } = r;
    void _dv; void _fms; void _ia; void _n;
    return rest;
  });
}

async function upsertBatch(
  label: string,
  rows: SourceRow[],
): Promise<{ ok: number; err: number }> {
  const BATCH = 500;
  let ok = 0;
  let err = 0;
  let useStripped = false;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const payload = useStripped ? stripProvenance(chunk) : chunk;
    const { error } = await s
      .from("permit_sources")
      .upsert(payload, { onConflict: "source_key", ignoreDuplicates: false });
    if (error) {
      // 42703 = undefined_column. Fired when migration 00052 hasn't
      // landed yet. Retry stripped, and switch every subsequent batch
      // to the stripped path.
      const missingCol =
        error.code === "42703" ||
        error.code === "PGRST204" ||
        /column .* does not exist/i.test(error.message ?? "") ||
        /could not find the .* column/i.test(error.message ?? "") ||
        /schema cache/i.test(error.message ?? "");
      if (missingCol && !useStripped) {
        useStripped = true;
        console.log(
          `  [${label}] migration 00052 columns missing — falling back to legacy schema`,
        );
        const { error: retryErr } = await s
          .from("permit_sources")
          .upsert(stripProvenance(chunk), {
            onConflict: "source_key",
            ignoreDuplicates: false,
          });
        if (retryErr) {
          console.warn(
            `  [${label}] batch ${i}-${i + BATCH} retry also failed: ${retryErr.message}`,
          );
          err += chunk.length;
        } else {
          ok += chunk.length;
        }
      } else {
        console.warn(
          `  [${label}] batch ${i}-${i + BATCH} failed: ${error.message}`,
        );
        err += chunk.length;
      }
    } else {
      ok += chunk.length;
    }
    if ((i / BATCH) % 4 === 0) {
      console.log(
        `  [${label}] ${ok.toLocaleString()} / ${rows.length.toLocaleString()}`,
      );
    }
  }
  return { ok, err };
}

/* ── Main ───────────────────────────────────────────────────────── */

(async () => {
  const BASE = "C:/Users/yabis/Desktop";
  const masterPath = `${BASE}/US_COMPREHENSIVE_MASTER.csv`;
  const nationwidePath = `${BASE}/nationwide_permit_apis.csv`;

  console.log("parsing CSVs...");
  const masterRows = readCsvObjects(masterPath);
  const nationwideRows = readCsvObjects(nationwidePath);
  console.log(
    `  US_COMPREHENSIVE_MASTER: ${masterRows.length.toLocaleString()} raw rows`,
  );
  console.log(
    `  nationwide_permit_apis : ${nationwideRows.length.toLocaleString()} raw rows`,
  );

  const m = adaptUsMaster(masterRows);
  const n = adaptNationwide(nationwideRows);

  console.log(`\n[us_master_csv] kept ${m.out.length.toLocaleString()} rows`);
  console.log(
    `  filtered: noState=${m.filtered.noState.toLocaleString()}, ` +
      `notRelevant=${m.filtered.notRelevant.toLocaleString()}, ` +
      `badUrl=${m.filtered.badUrl.toLocaleString()}`,
  );
  console.log(`[nationwide_csv] kept ${n.out.length.toLocaleString()} rows`);
  console.log(
    `  filtered: notRelevant=${n.filtered.notRelevant.toLocaleString()}, ` +
      `badUrl=${n.filtered.badUrl.toLocaleString()}`,
  );

  // Per-state breakdown of what we're about to import (top 10 states).
  const stateCount = new Map<string, number>();
  for (const r of [...m.out, ...n.out]) {
    stateCount.set(r.state, (stateCount.get(r.state) ?? 0) + 1);
  }
  const top = [...stateCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log("\nTop 10 states in the upcoming upsert:");
  for (const [st, c] of top) {
    console.log(`  ${st}: ${c.toLocaleString()}`);
  }

  // Allow capping for a smoke test.
  let mRows = m.out;
  let nRows = n.out;
  if (HARD_LIMIT > 0) {
    mRows = mRows.slice(0, HARD_LIMIT);
    nRows = nRows.slice(0, HARD_LIMIT);
    console.log(`\n[IMPORT_LIMIT=${HARD_LIMIT}] capping each adapter`);
  }

  console.log(`\nupserting ${mRows.length + nRows.length} rows...`);
  const mRes = await upsertBatch("us_master_csv", mRows);
  const nRes = await upsertBatch("nationwide_csv", nRows);
  console.log(
    `\n[us_master_csv] +${mRes.ok.toLocaleString()} ok, ${mRes.err} errors`,
  );
  console.log(
    `[nationwide_csv] +${nRes.ok.toLocaleString()} ok, ${nRes.err} errors`,
  );

  // Final summary — total rows in permit_sources, broken down by status.
  const { count: totalCount } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  console.log(
    `\npermit_sources now has ${totalCount?.toLocaleString() ?? "?"} rows total`,
  );

  const { count: enabledCount } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `  enabled=true (active scrape pool): ${enabledCount?.toLocaleString() ?? "?"}`,
  );

  console.log(
    "\nNext: run `npx tsx scripts/bulk-probe-sources.ts` to validate schema",
  );
  console.log(
    "      and flip promising sources to enabled=true. PROBE_LIMIT=200",
  );
  console.log("      is a reasonable first pass.");
})();
