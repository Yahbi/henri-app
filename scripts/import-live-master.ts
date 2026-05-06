/**
 * Import the validated-live US_LIVE_PERMITS_MASTER.csv dataset (~5,873
 * rows) into `permit_sources`. This is the highest-quality batch we've
 * imported — every endpoint was probed during this session and returned
 * HTTP 200 with a parseable response. Foreign records were already
 * filtered out per the upstream README at
 *   `C:/Users/yabis/Desktop/US_LIVE_PERMITS_COVERAGE.txt`.
 *
 * Why a separate importer:
 *   1. Different CSV schema (state,jurisdiction,source,name,domain,
 *      updated_at,latest_record_at,url,api_endpoint,status_code,description)
 *      vs the existing import-perfected-csv.ts shape.
 *   2. We trust the upstream live-validation, so these land with
 *      `enabled=true` and `field_mapping_status='probed'` — they jump
 *      straight into the active scrape pool without going through
 *      `bulk-probe-socrata.ts`.
 *   3. Separate provenance tag (`discovered_via='live_permits_master'`)
 *      so the founder can later distinguish auto-validated-live rows
 *      from bulk-imported-uncurated ones.
 *
 * SKIPS (intentional):
 *   - US_LIVE_PERMITS_ENHANCED.csv/json — confirmed to include foreign
 *     (datos.gov.co) and non-permit (skate parks) rows misclassified
 *     as US/permit. The MASTER variant is the deduped/filtered version.
 *   - US_LIVE_PERMITS_MASTER.json — same data as the CSV, no upside.
 *   - _permit_validated_cache.json — runtime probe cache, not source data.
 *
 * Idempotent on `source_key`. Re-runnable.
 *
 * Usage:
 *   pnpm import:live-master
 *   IMPORT_LIMIT=500 pnpm import:live-master   # smoke test
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
const CSV_PATH = "C:/Users/yabis/Desktop/US_LIVE_PERMITS_MASTER.csv";

/* ── CSV parser (same quote-aware, multi-line tolerant parser as
 *    import-desktop-catalogs.ts; copied verbatim) ────────────────── */

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

/* ── Permit-relevance filter (same as import-desktop-catalogs.ts).
 *    Defensive — the upstream MASTER.csv claims to be permit-only and
 *    foreign-filtered, but skate parks slipped into ENHANCED so we
 *    re-apply the negative-keyword filter as a safety net. ── */

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
  "dog license", "pet license", "burn permit", "fire permit",
  "block party", "garage sale", "vendor", "food truck",
  "noise variance", "special event", "outdoor event", "tobacco",
  "pesticide", "skate park", "playground",
  // Foreign/Spanish-language signals seen in ENHANCED — defensive only.
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

/* ── Platform inference ─────────────────────────────────────────── */

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
  if (low.includes("carto")) return "ckan"; // Carto is CKAN-shaped
  return "";
}

/* ── Canonical row factory ─────────────────────────────────────── */

function slug(v: string): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

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
  discovered_via: "live_permits_master";
  field_mapping_status: "probed";
  priority: number;
  imported_at: string;
  notes: string | null;
};

/* ── Adapter for US_LIVE_PERMITS_MASTER.csv ─────────────────────── */

function adapt(rows: Array<Record<string, string>>): {
  out: SourceRow[];
  filtered: { noEndpoint: number; notRelevant: number; nonOk: number; foreign: number };
} {
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const filtered = { noEndpoint: 0, notRelevant: 0, nonOk: 0, foreign: 0 };
  const now = new Date().toISOString();
  for (const r of rows) {
    const ep = (r.api_endpoint || "").trim();
    if (!ep || !ep.startsWith("http")) {
      filtered.noEndpoint++;
      continue;
    }
    // Defensive: drop foreign domains that the upstream filter missed.
    // A handful of www.datos.gov.co rows slipped into MASTER per a spot
    // check; this catches them.
    const dom = (r.domain || "").toLowerCase();
    if (
      dom.endsWith(".gov.co") ||
      dom.endsWith(".gob.mx") ||
      dom.endsWith(".gov.uk") ||
      dom.endsWith(".gov.ca") ||
      /\.(gov\.[a-z]{2,3})$/.test(dom)
    ) {
      filtered.foreign++;
      continue;
    }
    const code = Number(r.status_code || "0");
    if (code !== 0 && (code < 200 || code >= 400)) {
      filtered.nonOk++;
      continue;
    }
    if (!isPermitRelevant(r.name, r.description)) {
      filtered.notRelevant++;
      continue;
    }
    const platform: Platform =
      normPlatform(r.source || "") || platformFromUrl(ep);
    const stateUpper = (r.state || "").trim().toUpperCase();
    const state =
      stateUpper && /^[A-Z]{2}$/.test(stateUpper) ? stateUpper : "US";
    const city = (r.jurisdiction || "").trim() || null;
    const name = (r.name || "").trim() || `${platform} ${state}`;
    const notes = [
      r.description ? `desc=${r.description.slice(0, 400)}` : "",
      r.domain ? `domain=${r.domain}` : "",
      r.updated_at ? `updated=${r.updated_at}` : "",
      r.latest_record_at ? `latest=${r.latest_record_at}` : "",
      r.url && r.url !== ep ? `landing=${r.url}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const row: SourceRow = {
      source_key: buildKey(platform, state, city, name, ep),
      name: name.slice(0, 300),
      state,
      city,
      jurisdiction: null,
      endpoint: ep,
      source_type: platform,
      auth: "none",
      enabled: true, // pre-validated live
      discovered_via: "live_permits_master",
      field_mapping_status: "probed",
      priority: 10,
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
    /canceling statement/i.test(msg);
  if (isTimeout && chunk.length > 10 && depth < 6) {
    // Halve and retry. Supabase's statement_timeout on the service-role
    // pool gets exceeded by upserts that hit a lot of conflict rows.
    // Shrinking the batch usually clears it.
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
  // Smaller initial batch — these rows land enabled=true, so each
  // upsert touches the active scrape pool's index and can be slower.
  const BATCH = 50;
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
  console.log(`reading ${CSV_PATH} ...`);
  const rows = readCsvObjects(CSV_PATH);
  console.log(`  ${rows.length.toLocaleString()} raw rows`);

  const adapted = adapt(rows);
  console.log(
    `\n[live_permits_master] kept ${adapted.out.length.toLocaleString()} rows`,
  );
  console.log(
    `  filtered: noEndpoint=${adapted.filtered.noEndpoint}, ` +
      `notRelevant=${adapted.filtered.notRelevant}, ` +
      `nonOk=${adapted.filtered.nonOk}, ` +
      `foreign=${adapted.filtered.foreign}`,
  );

  // State distribution preview
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
  const res = await upsertBatch("live_permits_master", payload);
  console.log(
    `\n[live_permits_master] +${res.ok.toLocaleString()} ok, ${res.err} errors`,
  );

  // Final enabled count.
  const { count: enabledCount } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `\npermit_sources enabled=true now: ${enabledCount?.toLocaleString() ?? "?"}`,
  );

  console.log("\ndone.");
})();
