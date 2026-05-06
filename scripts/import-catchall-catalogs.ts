/**
 * Generic catch-all walker that scans every remaining permit-source catalog
 * CSV across three directories and upserts any state-tagged endpoints into
 * `permit_sources`.
 *
 * Scope:
 *   - `C:/Users/yabis/Desktop/Data Henri 3/`   (~60 CSVs — sweep artifacts)
 *   - `C:/Users/yabis/Desktop/henri data/`     (~10 CSVs — us_*.csv)
 *   - `C:/Users/yabis/Desktop/`                (~15 CSVs — root-level catalogs)
 *   - `D:/`                                    (state portal catalogs)
 *   - `D:/Data Onsite 2.0/`                    (openclaw catalog + coverage)
 *
 * Behaviors:
 *   - Header-driven column detection; falls back to a fixed layout for the
 *     three portal dumps (accela/etrakit/tyler) that ship without a header.
 *   - Skips rows where state isn't a 2-letter USPS code or endpoint isn't
 *     http(s).
 *   - Skips "section header" rows (state starts with "===").
 *   - Skips permit-RECORD dumps that have no recognizable endpoint column
 *     (detected via `noEndpointCol`).
 *   - Dedupes across all files in-memory by `source_key`.
 *   - Upserts in batches of 500 with `onConflict: source_key`.
 *   - Idempotent — safe to re-run; duplicates collapse on the existing key.
 *
 * Run:
 *   npx tsx scripts/import-catchall-catalogs.ts
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

/* ── CSV parser (quote-aware, copied from import-onsite-catalogs.ts) ─── */

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

function readCsvRaw(filePath: string): { header: string[]; rows: string[][] } {
  if (!fs.existsSync(filePath)) return { header: [], rows: [] };
  let raw: string;
  try { raw = fs.readFileSync(filePath, "utf-8"); }
  catch { return { header: [], rows: [] }; }
  // Strip BOM if present
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 1) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]).map((h) => h.trim().replace(/^\ufeff/, ""));
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    rows.push(parseCsvLine(lines[i]));
  }
  return { header, rows };
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
const VALID_STATE_CODES = new Set(Object.values(STATE_NAMES));

function normState(raw: string): string {
  const up = (raw ?? "").trim().toUpperCase();
  if (!up || up === "NATIONWIDE" || up === "US" || up === "USA" || up.startsWith("===")) return "";
  if (up.length === 2) return VALID_STATE_CODES.has(up) ? up : "";
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
  if (!low) return "";
  if (low.includes("arcgis")) return "arcgis";
  if (low.includes("socrata")) return "socrata";
  if (low.includes("ckan")) return "ckan";
  if (low.includes("accela")) return "accela";
  if (low.includes("etrakit")) return "etrakit";
  if (low.includes("tyler")) return "tyler";
  return "";
}

function platformFromUrl(url: string): string {
  const u = (url ?? "").toLowerCase();
  if (u.includes("arcgis.com")) return "arcgis";
  if (/\/resource\/[a-z0-9-]+\.json/.test(u)) return "socrata";
  if (/\/api\/views\//.test(u)) return "socrata";
  if (/data\.[^/]+\.(gov|org|us)\/data\.json$/.test(u)) return "ckan";
  if (u.includes("accela.com")) return "accela";
  if (u.includes("etrakit")) return "etrakit";
  if (u.includes("tylerhost") || u.includes("energovweb")) return "tyler";
  if (u.endsWith(".csv") || u.includes("/datastore/dump/")) return "csv";
  return "unknown";
}

/* ── Row shape ────────────────────────────────────────────────────── */

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

function mkRow(p: {
  platform: string;
  state: string;
  name: string;
  endpoint: string;
  city?: string | null;
  jurisdiction?: string | null;
}): SourceRow | null {
  const ep = (p.endpoint ?? "").trim();
  if (!ep || !ep.startsWith("http")) return null;
  const state = p.state;
  if (!state || state.length !== 2) return null;
  const platform = p.platform || "unknown";
  const name = (p.name ?? "").trim() || `${platform} ${state}`;
  const city = p.city ? p.city.trim() || null : null;
  const jurisdiction = p.jurisdiction ? p.jurisdiction.trim() || null : null;
  return {
    source_key: buildKey(platform, state, city, name, ep),
    name: name.slice(0, 300),
    state,
    city,
    jurisdiction,
    endpoint: ep,
    source_type: platform,
    auth: "none",
    enabled: false,
  };
}

/* ── Header column detection ──────────────────────────────────────── */

/** Case-insensitive. Returns index or -1 if not present. */
function findCol(header: string[], patterns: RegExp[]): number {
  for (let i = 0; i < header.length; i++) {
    const h = header[i]?.toLowerCase().trim() ?? "";
    for (const p of patterns) {
      if (p.test(h)) return i;
    }
  }
  return -1;
}

type ColMap = {
  endpoint: number;
  state: number;
  city: number;
  jurisdiction: number;
  name: number;
  platform: number;
};

function detectCols(header: string[]): ColMap {
  return {
    endpoint: findCol(header, [
      /^(api_?endpoint|endpoint|endpoint_?url|api_?url|service_?url|query_?url|full api endpoint|full url|featureserver_url|resource_?url|data_?url|portal_?url|url)$/,
      /^full api endpoint/,
      /^full url$/,
      /^primary_?api$/,
    ]),
    state: findCol(header, [/^(state|state_code|state_abbr|state_guess)$/]),
    city: findCol(header, [/^(city|jurisdiction|portal_?name)$/]),
    jurisdiction: findCol(header, [/^(county|jurisdiction)$/]),
    name: findCol(header, [
      /^(name|api_?name|title|dataset_?name|source name|notes|portal_?name)$/,
    ]),
    platform: findCol(header, [
      /^(source_?type|api_?type|platform|source_?platform)$/,
    ]),
  };
}

/* ── Headerless portal-CSV adapter ────────────────────────────────── */

/**
 * accela_portals.csv / etrakit_portals.csv / tyler_portals.csv ship without
 * a header. Column layout (by inspection):
 *   0 zip, 1 city, 2 county, 3 state, 4 access_notes, 5 vendor, 6 portal_url
 */
function rowsFromHeaderlessPortal(filePath: string, vendorHint: string): SourceRow[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const c = parseCsvLine(line);
    if (c.length < 7) continue;
    const state = normState(c[3] ?? "");
    const city = c[1] ?? "";
    const jurisdiction = c[2] ?? "";
    const platform = normPlatform(c[5] ?? vendorHint) || vendorHint;
    const endpoint = (c[6] ?? "").trim();
    const row = mkRow({
      platform,
      state,
      name: `${vendorHint} ${city || state}`,
      endpoint,
      city: city || null,
      jurisdiction: jurisdiction || null,
    });
    if (row && !seen.has(row.source_key)) { seen.add(row.source_key); out.push(row); }
  }
  return out;
}

/* ── Generic header-driven walker ────────────────────────────────── */

type FileStats = {
  file: string;
  scanned: number;
  emitted: number;
  skipReason: string | null;
};

function rowsFromHeaderedCsv(filePath: string): { rows: SourceRow[]; stats: FileStats } {
  const stats: FileStats = { file: path.basename(filePath), scanned: 0, emitted: 0, skipReason: null };
  const { header, rows } = readCsvRaw(filePath);
  if (header.length === 0 || rows.length === 0) {
    stats.skipReason = "empty-or-unreadable";
    return { rows: [], stats };
  }
  const cols = detectCols(header);
  if (cols.endpoint < 0) {
    stats.skipReason = "no-endpoint-column";
    return { rows: [], stats };
  }
  if (cols.state < 0) {
    stats.skipReason = "no-state-column";
    return { rows: [], stats };
  }

  const out: SourceRow[] = [];
  const seen = new Set<string>();
  for (const c of rows) {
    stats.scanned++;
    if (c.length < 2) continue;
    const stateRaw = (c[cols.state] ?? "").trim();
    if (stateRaw.startsWith("===")) continue;
    const state = normState(stateRaw);
    if (!state) continue;

    const endpoint = (c[cols.endpoint] ?? "").trim();
    if (!endpoint || !endpoint.startsWith("http")) continue;

    const platformRaw = cols.platform >= 0 ? (c[cols.platform] ?? "") : "";
    const platform = normPlatform(platformRaw) || platformFromUrl(endpoint);

    const name = cols.name >= 0 ? (c[cols.name] ?? "") : "";
    const city = cols.city >= 0 ? (c[cols.city] ?? "") : "";
    const jurisdiction = cols.jurisdiction >= 0 ? (c[cols.jurisdiction] ?? "") : "";

    const row = mkRow({
      platform,
      state,
      name,
      endpoint,
      city: city || null,
      jurisdiction: jurisdiction || null,
    });
    if (row && !seen.has(row.source_key)) { seen.add(row.source_key); out.push(row); }
  }
  stats.emitted = out.length;
  return { rows: out, stats };
}

/* ── Directory walk ───────────────────────────────────────────────── */

function listCsvs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir);
  return names
    .filter((n) => n.toLowerCase().endsWith(".csv"))
    .filter((n) => !/_BACKUP\.csv$/i.test(n))
    .filter((n) => !/\.json$|\.numbers$|\.md$/i.test(n))
    .map((n) => path.join(dir, n));
}

/* ── Upsert ───────────────────────────────────────────────────────── */

async function upsertBatch(rows: SourceRow[]): Promise<{ ok: number; err: number }> {
  const BATCH = 500;
  let ok = 0;
  let err = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await s
      .from("permit_sources")
      .upsert(chunk, { onConflict: "source_key", ignoreDuplicates: false });
    if (error) {
      console.warn(`  batch ${i}-${i + BATCH} failed: ${error.message}`);
      err += chunk.length;
    } else {
      ok += chunk.length;
    }
    if ((i / BATCH) % 4 === 0) {
      console.log(`  progress ${ok.toLocaleString()} / ${rows.length.toLocaleString()}`);
    }
  }
  return { ok, err };
}

/* ── Main ─────────────────────────────────────────────────────────── */

(async () => {
  const DIRS = [
    "C:/Users/yabis/Desktop/Data Henri 3",
    "C:/Users/yabis/Desktop/henri data",
    "C:/Users/yabis/Desktop",
    "D:/",
    "D:/Data Onsite 2.0",
  ];

  // Headerless portal CSVs (layout: zip,city,county,state,access,vendor,url)
  const HEADERLESS = new Map<string, string>([
    ["accela_portals.csv", "accela"],
    ["etrakit_portals.csv", "etrakit"],
    ["tyler_portals.csv", "tyler"],
  ]);

  const { count: before } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  console.log(`permit_sources start count: ${before?.toLocaleString() ?? "?"}\n`);

  const allFiles: string[] = [];
  for (const d of DIRS) {
    allFiles.push(...listCsvs(d));
  }
  console.log(`scanning ${allFiles.length} CSV files...\n`);

  const globalByKey = new Map<string, SourceRow>();
  const perFileStats: FileStats[] = [];

  for (const f of allFiles) {
    const basename = path.basename(f);
    let rows: SourceRow[];
    let stats: FileStats;
    if (HEADERLESS.has(basename)) {
      const vendor = HEADERLESS.get(basename)!;
      rows = rowsFromHeaderlessPortal(f, vendor);
      stats = {
        file: basename,
        scanned: rows.length,
        emitted: rows.length,
        skipReason: rows.length === 0 ? "empty-portal-csv" : null,
      };
    } else {
      const res = rowsFromHeaderedCsv(f);
      rows = res.rows;
      stats = res.stats;
    }
    perFileStats.push(stats);
    for (const r of rows) {
      if (!globalByKey.has(r.source_key)) globalByKey.set(r.source_key, r);
    }
  }

  const skipped = perFileStats.filter((s) => s.skipReason);
  const emitted = perFileStats.filter((s) => !s.skipReason);
  console.log(`files with rows extracted: ${emitted.length}`);
  console.log(`files skipped: ${skipped.length}`);
  const skipReasons = new Map<string, number>();
  for (const sk of skipped) {
    skipReasons.set(sk.skipReason!, (skipReasons.get(sk.skipReason!) ?? 0) + 1);
  }
  for (const [reason, n] of skipReasons) {
    console.log(`  [${reason}]: ${n}`);
  }

  const totalExtracted = perFileStats.reduce((a, b) => a + b.emitted, 0);
  console.log(`\ntotal rows extracted (pre-dedupe): ${totalExtracted.toLocaleString()}`);
  console.log(`unique source_keys (post-dedupe):  ${globalByKey.size.toLocaleString()}`);

  const rowsToUpsert = Array.from(globalByKey.values());
  if (rowsToUpsert.length === 0) {
    console.log("\nno rows to upsert — exiting.");
    return;
  }

  console.log(`\nupserting ${rowsToUpsert.length.toLocaleString()} rows...`);
  const { ok, err } = await upsertBatch(rowsToUpsert);
  console.log(`upsert complete: ${ok.toLocaleString()} ok, ${err} errors`);

  const { count: after } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  const netNew = (after ?? 0) - (before ?? 0);
  console.log(`\npermit_sources end count: ${after?.toLocaleString() ?? "?"}`);
  console.log(`net-new rows this run: ${netNew.toLocaleString()}`);

  console.log(
    `\nSUMMARY: files scanned=${allFiles.length}, ` +
    `rows extracted=${totalExtracted.toLocaleString()}, ` +
    `rows upserted=${ok.toLocaleString()}, errors=${err}, net-new=${netNew.toLocaleString()}`,
  );
})();
