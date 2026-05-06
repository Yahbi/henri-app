/**
 * Import four research-drop CSVs from `~/Desktop/Data for Onsite/` into
 * the `permit_sources` table.
 *
 * All four catalogs were identified by the Explore-agent scan as the
 * highest-yield files for net-new state-tagged endpoints. They use
 * incompatible column shapes, so this script has four adapters that
 * converge on the canonical SourceRow shape that matches our table.
 *
 * Priority order (runs in one invocation):
 *   1. FINAL_permit_apis_validated.csv    (API2.0/api) — pre-validated, Socrata-heavy
 *   2. nationwide_permit_apis_complete.csv (Onsite data) — small, clean, CKAN state portals
 *   3. US_Construction_Permit_APIs_Complete.csv (API2.0/api) — construction-specific
 *   4. arcgis_all_permit_datasets.csv     (API2.0/api) — ArcGIS service URLs (no state col; we skip state-less rows)
 *
 * Everything lands with `enabled=false`. The existing
 * `scripts/bulk-probe-sources.ts` is the gate that flips enabled=true.
 *
 * Idempotent via `source_key` UPSERT. Safe to re-run.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/* ── CSV parser (quote-aware, matches import-permit-catalog.ts) ─── */

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') { inQuotes = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

function readCsv(filePath: string): Array<Record<string, string>> {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (c.length < 2) continue; // clearly broken row
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h.trim()] = (c[idx] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

/* ── Normalizers shared with import-extra-permit-sources.ts ─────── */

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
  if (!up || up === "NATIONWIDE" || up.startsWith("===")) return "";
  if (up.length === 2) return up;
  return STATE_NAMES[up] ?? "";
}

function slug(v: string): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normPlatform(raw: string): string {
  const low = (raw ?? "").toLowerCase().trim();
  if (low.includes("arcgis")) return "arcgis";
  if (low.includes("socrata")) return "socrata";
  if (low.includes("ckan")) return "ckan";
  if (low.includes("accela")) return "accela";
  if (low.includes("etrakit")) return "etrakit";
  if (low.includes("tyler")) return "tyler";
  // Heuristic from URL when platform column is blank/unhelpful.
  return "";
}
function platformFromUrl(url: string): string {
  const u = (url ?? "").toLowerCase();
  if (u.includes("arcgis.com")) return "arcgis";
  if (/\/resource\/[a-z0-9-]+\.json/.test(u)) return "socrata";
  if (/\/api\/views\//.test(u)) return "socrata";
  if (/data\.[^/]+\.(gov|org|us)\/data\.json$/.test(u)) return "ckan";
  if (u.endsWith(".csv") || u.includes("/datastore/dump/")) return "csv";
  return "unknown";
}

type SourceRow = {
  source_key: string;
  name: string;
  state: string;
  city: string | null;
  jurisdiction: string | null;
  endpoint: string;
  source_type: string;
  auth: string;
  enabled: boolean;
};

function buildKey(platform: string, state: string, city: string | null, name: string, endpoint: string): string {
  const epHash = slug(endpoint).slice(-12);
  return `${platform}:${state}:${slug(city ?? "")}:${slug(name)}:${epHash}`.slice(0, 200);
}

function mkRow(partial: {
  platform: string;
  state: string;
  name: string;
  endpoint: string;
  city?: string | null;
  jurisdiction?: string | null;
}): SourceRow | null {
  if (!partial.endpoint || !partial.endpoint.startsWith("http")) return null;
  if (!partial.state || partial.state.length !== 2) return null;
  return {
    source_key: buildKey(
      partial.platform || "unknown",
      partial.state,
      partial.city ?? null,
      partial.name,
      partial.endpoint,
    ),
    name: (partial.name ?? "").slice(0, 300) || `${partial.platform} ${partial.state}`,
    state: partial.state,
    city: partial.city ?? null,
    jurisdiction: partial.jurisdiction ?? null,
    endpoint: partial.endpoint,
    source_type: partial.platform || "unknown",
    auth: "none",
    enabled: false,
  };
}

/* ── 4 per-file adapters ────────────────────────────────────────── */

function adaptValidated(rows: Array<Record<string, string>>): SourceRow[] {
  // Header: jurisdiction,state,county,api_name,api_url,base_domain,api_type,dataset_id,...
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const platform = normPlatform(r.api_type || "") || platformFromUrl(r.api_url || "");
    const row = mkRow({
      platform,
      state: normState(r.state || ""),
      name: r.api_name || `${r.jurisdiction} ${r.county}`.trim(),
      endpoint: r.api_url || "",
      city: r.jurisdiction || null,
      jurisdiction: r.county || null,
    });
    if (row && !seen.has(row.source_key)) { seen.add(row.source_key); out.push(row); }
  }
  return out;
}

function adaptNationwide(rows: Array<Record<string, string>>): SourceRow[] {
  // Header: source_type,jurisdiction,jurisdiction_type,state,state_code,county,domain,dataset_id,endpoint_url,notes
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const platform = normPlatform(r.source_type || "") || platformFromUrl(r.endpoint_url || "");
    const state = normState(r.state_code || r.state || "");
    const row = mkRow({
      platform,
      state,
      name: r.notes || r.jurisdiction || "",
      endpoint: r.endpoint_url || "",
      city: r.jurisdiction_type === "city" ? r.jurisdiction : null,
      jurisdiction: r.county || null,
    });
    if (row && !seen.has(row.source_key)) { seen.add(row.source_key); out.push(row); }
  }
  return out;
}

function adaptUsConstruction(rows: Array<Record<string, string>>): SourceRow[] {
  // Header: State,Jurisdiction,Source Name,Full API Endpoint / Direct URL,Data Format,Permit Types Covered,Access Type,Platform
  // Filter out section-header rows like "=== FEDERAL / NATIONAL SOURCES ==="
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if ((r.State || "").startsWith("===")) continue; // section header
    const ep = r["Full API Endpoint / Direct URL"] || "";
    const platform = normPlatform(r.Platform || "") || platformFromUrl(ep);
    const row = mkRow({
      platform,
      state: normState(r.State || ""),
      name: r["Source Name"] || r.Jurisdiction || "",
      endpoint: ep,
      city: r.Jurisdiction || null,
    });
    if (row && !seen.has(row.source_key)) { seen.add(row.source_key); out.push(row); }
  }
  return out;
}

function adaptArcgisDatasets(rows: Array<Record<string, string>>): SourceRow[] {
  // Header: title,hub_url,service_url,organization,tags,last_updated,source_method,queryable
  // No state column — we skip rows where we can't derive a state. Some titles embed "CA" /
  // "Chicago" / org domains; attempting to derive is error-prone, so we only accept rows where
  // the `organization` or `title` explicitly contains a known US state code in parentheses
  // (common AGOL naming convention: "City of Austin, TX" or "Austin TX Open Data").
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const STATE_RE = new RegExp(
    "\\b(" + Object.values(STATE_NAMES).join("|") + ")\\b",
  );
  for (const r of rows) {
    if ((r.queryable ?? "").toLowerCase() === "false") continue;
    const ep = r.service_url || "";
    if (!ep.startsWith("http")) continue;
    const haystack = `${r.title ?? ""} ${r.organization ?? ""}`;
    const match = haystack.toUpperCase().match(STATE_RE);
    if (!match) continue; // can't pin a state; skip
    const state = match[1];
    const row = mkRow({
      platform: "arcgis",
      state,
      name: r.title || r.organization || "",
      endpoint: ep,
      city: null,
      jurisdiction: r.organization || null,
    });
    if (row && !seen.has(row.source_key)) { seen.add(row.source_key); out.push(row); }
  }
  return out;
}

/* ── Upsert ─────────────────────────────────────────────────────── */

async function upsertBatch(label: string, rows: SourceRow[]): Promise<{ ok: number; err: number }> {
  const BATCH = 500;
  let ok = 0;
  let err = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await s
      .from("permit_sources")
      .upsert(chunk, { onConflict: "source_key", ignoreDuplicates: false });
    if (error) {
      console.warn(`  [${label}] batch ${i}-${i + BATCH} failed: ${error.message}`);
      err += chunk.length;
    } else {
      ok += chunk.length;
    }
    if ((i / BATCH) % 4 === 0) {
      console.log(`  [${label}] ${ok.toLocaleString()} / ${rows.length.toLocaleString()}`);
    }
  }
  return { ok, err };
}

/* ── Main ──────────────────────────────────────────────────────── */

(async () => {
  const BASE = "C:/Users/yabis/Desktop/Data for Onsite";
  const batches: Array<{ label: string; rows: SourceRow[] }> = [];

  const validatedPath = `${BASE}/API2.0/api/FINAL_permit_apis_validated.csv`;
  const nationwidePath = `${BASE}/Onsite data/nationwide_permit_apis_complete.csv`;
  const usConstructionPath = `${BASE}/API2.0/api/US_Construction_Permit_APIs_Complete.csv`;
  const arcgisPath = `${BASE}/API2.0/api/arcgis_all_permit_datasets.csv`;

  console.log("parsing CSVs...");
  const v = adaptValidated(readCsv(validatedPath));
  const n = adaptNationwide(readCsv(nationwidePath));
  const u = adaptUsConstruction(readCsv(usConstructionPath));
  const a = adaptArcgisDatasets(readCsv(arcgisPath));
  batches.push({ label: "validated",  rows: v });
  batches.push({ label: "nationwide", rows: n });
  batches.push({ label: "us-construction", rows: u });
  batches.push({ label: "arcgis-datasets", rows: a });

  for (const b of batches) {
    console.log(`[${b.label}] prepared ${b.rows.length.toLocaleString()} rows`);
  }
  console.log(`\nupserting...`);

  let total = 0;
  let totalErr = 0;
  for (const b of batches) {
    if (b.rows.length === 0) continue;
    const { ok, err } = await upsertBatch(b.label, b.rows);
    total += ok;
    totalErr += err;
    console.log(`[${b.label}] +${ok.toLocaleString()} ok, ${err} errors`);
  }
  console.log(`\nTotal upserted: ${total.toLocaleString()}, errors: ${totalErr}`);

  const { count } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  console.log(`permit_sources now has ${count?.toLocaleString() ?? "?"} rows total`);
})();
