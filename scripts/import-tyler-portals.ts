/**
 * Import Tyler Tech / EnerGov permit-portal endpoints into `permit_sources`.
 *
 * Source: C:/Users/yabis/Desktop/Data Henri 3/tyler_portals.csv
 *   Header: zip,city,county,state,api_available,vendor,url
 *   File ships WITHOUT a header row — the columns above are positional.
 *
 * Tyler / EnerGov is a permit-portal vendor whose endpoints typically
 * require an authenticated scraper or FOIA — they are NOT machine-readable
 * Socrata/ArcGIS APIs. We catalog them anyway because they are valid
 * permit data sources we'll eventually enable a Tyler scraper for.
 *
 *   - source_type:    'unknown' (no scraper handles Tyler today)
 *   - enabled:        false
 *   - discovered_via: 'tyler_portals'
 *   - notes:          'vendor=tyler, api_available=<value>'
 *
 * Foreign-domain filter is applied defensively even though every row in
 * the source file is US.
 *
 * Idempotent — re-running upserts on `source_key`.
 *
 * Usage:
 *   npx tsx scripts/import-tyler-portals.ts
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

/* ── CSV parser (quote-aware, multi-line tolerant) — verbatim from
 *    scripts/import-desktop-catalogs.ts ─────────────────────────────── */

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

/* ── Helpers (verbatim from scripts/import-desktop-catalogs.ts) ────── */

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

/* ── Foreign-domain filter (verbatim from scripts/import-hd-sources.ts) */

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

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/* ── Canonical row ─────────────────────────────────────────────────── */

type SourceRow = {
  source_key: string;
  name: string;
  state: string;
  city: string | null;
  jurisdiction: string | null;
  endpoint: string;
  source_type: "unknown";
  auth: string;
  enabled: boolean;
  discovered_via: "tyler_portals";
  field_mapping_status: "unknown";
  imported_at: string;
  notes: string | null;
};

/* ── Provenance-strip fallback (verbatim from
 *    scripts/import-desktop-catalogs.ts) ──────────────────────────── */

type StrippedRow = Omit<
  SourceRow,
  "discovered_via" | "field_mapping_status" | "imported_at" | "notes"
>;
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
  }
  return { ok, err };
}

/* ── Main ──────────────────────────────────────────────────────────── */

(async () => {
  const filePath = "C:/Users/yabis/Desktop/Data Henri 3/tyler_portals.csv";
  if (!fs.existsSync(filePath)) {
    console.error(`file not found: ${filePath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const grid = parseCsv(raw);
  console.log(`tyler_portals.csv: ${grid.length.toLocaleString()} raw rows (no header)`);

  // Pre-count.
  const { count: totalBefore } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  const { count: enabledBefore } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `\npermit_sources before: total=${totalBefore?.toLocaleString() ?? "?"}, enabled=${enabledBefore?.toLocaleString() ?? "?"}`,
  );

  // Parse positional rows: zip,city,county,state,api_available,vendor,url
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const filtered = { empty: 0, noUrl: 0, foreign: 0, dup: 0 };

  for (const cells of grid) {
    if (cells.length < 7) {
      filtered.empty++;
      continue;
    }
    const [zipRaw, cityRaw, countyRaw, stateRaw, apiRaw, vendorRaw, urlRaw] = cells;
    const zip = (zipRaw ?? "").trim();
    const city = (cityRaw ?? "").trim();
    const county = (countyRaw ?? "").trim();
    const state = (stateRaw ?? "").trim().toUpperCase();
    const api = (apiRaw ?? "").trim();
    const vendor = (vendorRaw ?? "").trim();
    const url = (urlRaw ?? "").trim();

    if (!url || !url.startsWith("http")) {
      filtered.noUrl++;
      continue;
    }
    if (isForeignDomain(hostFromUrl(url))) {
      filtered.foreign++;
      continue;
    }

    // Per spec: do NOT apply isPermitRelevant aggressively — these ARE
    // all permit portals by definition.

    const platform: SourceRow["source_type"] = "unknown";
    const safeState = state && /^[A-Z]{2}$/.test(state) ? state : "US";
    const name =
      `${city || "Tyler portal"}${county ? ` (${county})` : ""}${zip ? ` ZIP ${zip}` : ""}`.trim();

    const row: SourceRow = {
      source_key: buildKey(platform, safeState, city || null, name, url),
      name: name.slice(0, 300) || `Tyler portal ${safeState}`,
      state: safeState,
      city: city || null,
      jurisdiction: county || null,
      endpoint: url,
      source_type: platform,
      auth: "none",
      enabled: false,
      discovered_via: "tyler_portals",
      field_mapping_status: "unknown",
      imported_at: new Date().toISOString(),
      notes: `vendor=${vendor || "tyler"}, api_available=${api || "unknown"}`.slice(0, 1000),
    };
    if (seen.has(row.source_key)) {
      filtered.dup++;
      continue;
    }
    seen.add(row.source_key);
    out.push(row);
  }

  console.log(`\n[tyler_portals] kept ${out.length.toLocaleString()} rows`);
  console.log(
    `  filtered: empty=${filtered.empty}, noUrl=${filtered.noUrl}, foreign=${filtered.foreign}, dup=${filtered.dup}`,
  );

  if (out.length === 0) {
    console.log("nothing to upsert");
    return;
  }

  console.log(`\nupserting ${out.length} rows...`);
  const res = await upsertBatch("tyler_portals", out);
  console.log(
    `\n[tyler_portals] +${res.ok.toLocaleString()} ok, ${res.err} errors`,
  );

  const { count: totalAfter } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  const { count: enabledAfter } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `\npermit_sources after: total=${totalAfter?.toLocaleString() ?? "?"}, enabled=${enabledAfter?.toLocaleString() ?? "?"}`,
  );
})();
