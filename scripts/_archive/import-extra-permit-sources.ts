/**
 * Import supplementary permit-source catalogs into `permit_sources`.
 *
 * The main catalog (`US_Permit_APIs_Complete_Master_Final.csv`) has been
 * imported via `import-permit-catalog.ts`. This script mops up four
 * adjacent catalogs that the main script either doesn't cover or skips
 * because of schema differences:
 *
 *   1. us_verified_working_apis.csv   — 3,143 rows, all already probed
 *                                        live (status=verified_working).
 *   2. us_permit_apis_VERIFIED.csv    — 90 manually-curated endpoints.
 *   3. socrata_permit_datasets.csv    — 10,628 state-tagged Socrata DBs.
 *   4. arcgis_permit_services_full.csv — 928 ArcGIS FeatureServers.
 *
 * Every row is upserted on `source_key` with `enabled=false`. The
 * `bulk-probe-sources.ts` script is the gate that flips enabled=true
 * after live probing — we never auto-enable here.
 *
 * Run:
 *   npx tsx scripts/import-extra-permit-sources.ts
 *
 * Idempotent — re-running upserts the same keys.
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

/* ── CSV parsing ────────────────────────────────────────────────── */

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

function readCsv(path: string): Array<Record<string, string>> {
  const raw = fs.readFileSync(path, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (c.length < header.length / 2) continue; // clearly broken
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h] = (c[idx] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

/* ── Normalizers ─────────────────────────────────────────────────── */

/** Full state name → USPS 2-letter code. Several catalogs spell
 *  states out ("CALIFORNIA" / "TEXAS") instead of using the code. */
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

function normState(s: string): string {
  const up = (s ?? "").trim().toUpperCase();
  if (!up) return "";
  if (up.length === 2) return up;
  return STATE_NAMES[up] ?? up.slice(0, 2);
}

function slug(s: string): string {
  return (s ?? "")
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
  return low || "unknown";
}

/* ── Row builders for each catalog ──────────────────────────────── */

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

function buildRows(
  label: string,
  rows: Array<Record<string, string>>,
  cfg: { epCol: string; stateCol: string; nameCol?: string; cityCol?: string; platformCol?: string; platformDefault?: string; jurisdictionCol?: string },
): SourceRow[] {
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const endpoint = (r[cfg.epCol] ?? "").trim();
    if (!endpoint || !endpoint.startsWith("http")) continue;
    const state = normState(r[cfg.stateCol] ?? "");
    if (!state || state.length !== 2) continue;

    const platformRaw = cfg.platformCol ? r[cfg.platformCol] : cfg.platformDefault ?? "";
    const platform = normPlatform(platformRaw);
    const name = (cfg.nameCol ? r[cfg.nameCol] : "")?.trim() || `${platform} ${state}`;
    const city = (cfg.cityCol ? r[cfg.cityCol] : "")?.trim() || null;
    const jurisdiction = (cfg.jurisdictionCol ? r[cfg.jurisdictionCol] : "")?.trim() || null;

    // Stable key: platform:state:city:name — matches existing pattern.
    // Include endpoint hash suffix to guarantee uniqueness across datasets
    // with the same name in the same city (e.g., "Building Permits" in
    // two NYC agencies).
    const epHash = slug(endpoint).slice(-12);
    const key = `${platform}:${state}:${slug(city ?? "")}:${slug(name)}:${epHash}`.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      source_key: key,
      name: name.slice(0, 300),
      state,
      city,
      jurisdiction,
      endpoint,
      source_type: platform,
      auth: "none",
      enabled: false,
    });
  }
  console.log(`[${label}] prepared ${out.length.toLocaleString()} rows for upsert`);
  return out;
}

/* ── Upsert in batches ──────────────────────────────────────────── */

async function upsertBatch(label: string, rows: SourceRow[]): Promise<{ inserted: number; errors: number }> {
  const BATCH = 500;
  let inserted = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await s
      .from("permit_sources")
      .upsert(chunk, { onConflict: "source_key", ignoreDuplicates: false });
    if (error) {
      console.warn(`  [${label}] batch ${i}-${i + BATCH} errored: ${error.message}`);
      errors += chunk.length;
    } else {
      inserted += chunk.length;
    }
    if ((i / BATCH) % 4 === 0) {
      console.log(`  [${label}] progress ${inserted.toLocaleString()} / ${rows.length.toLocaleString()}`);
    }
  }
  return { inserted, errors };
}

/* ── Main ──────────────────────────────────────────────────────── */

(async () => {
  const DESKTOP = "C:/Users/yabis/Desktop";

  const batches: Array<[string, SourceRow[]]> = [];

  // 1. VERIFIED (smallest, highest quality)
  const verifiedPath = `${DESKTOP}/henri data/us_permit_apis_VERIFIED.csv`;
  if (fs.existsSync(verifiedPath)) {
    const rows = readCsv(verifiedPath);
    batches.push(["verified", buildRows("verified", rows, {
      epCol: "endpoint_url", stateCol: "state_code",
      nameCol: "notes", cityCol: "jurisdiction",
      platformCol: "source_type",
    })]);
  }

  // 2. WORKING APIs (already probed live)
  const workingPath = `${DESKTOP}/henri data/us_verified_working_apis.csv`;
  if (fs.existsSync(workingPath)) {
    const rows = readCsv(workingPath);
    batches.push(["working", buildRows("working", rows, {
      epCol: "endpoint_url", stateCol: "state_code",
      nameCol: "notes", cityCol: "jurisdiction",
      platformCol: "source_type",
    })]);
  }

  // 3. ArcGIS feature services (~480 new)
  const arcgisPath = `${DESKTOP}/arcgis_permit_services_full.csv`;
  if (fs.existsSync(arcgisPath)) {
    const rows = readCsv(arcgisPath);
    batches.push(["arcgis", buildRows("arcgis", rows, {
      epCol: "query_url", stateCol: "state",
      nameCol: "title", cityCol: "city",
      platformDefault: "arcgis",
    })]);
  }

  // 4. Socrata datasets (10k new — biggest expansion)
  const socrataPath = `${DESKTOP}/socrata_permit_datasets.csv`;
  if (fs.existsSync(socrataPath)) {
    const rows = readCsv(socrataPath);
    batches.push(["socrata", buildRows("socrata", rows, {
      epCol: "api_endpoint", stateCol: "state",
      nameCol: "name", cityCol: "city",
      platformDefault: "socrata",
    })]);
  }

  console.log("\n--- upserting ---");
  let grand = 0, errs = 0;
  for (const [label, rows] of batches) {
    if (rows.length === 0) continue;
    const { inserted, errors } = await upsertBatch(label, rows);
    grand += inserted;
    errs += errors;
    console.log(`[${label}] done: +${inserted.toLocaleString()} ok, ${errors} errors`);
  }

  console.log(`\nTotal upserted: ${grand.toLocaleString()}, errors: ${errs}`);

  // Final row count
  const { count: total } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  console.log(`permit_sources now has ${total?.toLocaleString() ?? "?"} rows total`);
})();
