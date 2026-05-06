/**
 * Import the curated US construction-data-sources catalog into
 * `permit_sources`.
 *
 * Source: C:/Users/yabis/Desktop/Data Henri 3/us_construction_data_sources.csv
 *   Header: Category,Portal_Name,Domain,URL,Type,Source
 *
 * Filtering:
 *   - Drop rows whose Type/Category mention non-permit material (news,
 *     blog, podcast, video). Keep rows where ANY of {Type, Category,
 *     Portal_Name} hint at permit/license/construction/GIS/building.
 *   - Apply the foreign-domain filter (defensive — should be all US).
 *   - State is inferred from Domain via DOMAIN_TO_STATE (verbatim from
 *     scripts/import-desktop-catalogs.ts).
 *   - source_type is derived from Source/URL via existing platform
 *     normalization helpers; rows we can't classify land as 'unknown'.
 *
 * Settings:
 *   - enabled:        false
 *   - discovered_via: 'construction_data_sources'
 *
 * Idempotent — re-running upserts on `source_key`.
 *
 * Usage:
 *   npx tsx scripts/import-construction-data-sources.ts
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

/* ── CSV parser (verbatim from scripts/import-desktop-catalogs.ts) ── */

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

/* ── Helpers (verbatim from scripts/import-desktop-catalogs.ts) ───── */

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

/* ── DOMAIN_TO_STATE table (verbatim from
 *    scripts/import-desktop-catalogs.ts) ──────────────────────────── */

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

function stateFromDomain(domain: string): string {
  const dom = (domain ?? "").toLowerCase().trim();
  if (DOMAIN_TO_STATE[dom]) return DOMAIN_TO_STATE[dom];
  return "";
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

/* ── Permit-relevance filter (looser than the desktop catalog one) ── */
const PERMIT_KEYWORDS = [
  "permit", "license", "construction", "building", "remodel",
  "renovation", "addition", "solar", "roof", "hvac", "plumbing",
  "electrical", "demolition", "septic", "zoning", "subdivision",
  "site plan", "variance", "occupancy", "inspection", "gis",
  "parcel", "code enforcement", "contractor",
];
const NEGATIVE = [
  "blog", "news", "podcast", "press release", "youtube", "video",
  "magazine", "newsletter", "marriage", "marijuana", "cannabis",
  "alcohol", "liquor", "firearm", "weapon", "concealed carry",
  "fishing", "hunt", "dog license", "pet license",
];

function isPermitMaterial(...fields: (string | undefined)[]): boolean {
  const haystack = fields.map((f) => (f ?? "").toLowerCase()).join(" ");
  if (haystack.length === 0) return false;
  for (const n of NEGATIVE) {
    if (haystack.includes(n)) return false;
  }
  for (const p of PERMIT_KEYWORDS) {
    if (haystack.includes(p)) return true;
  }
  return false;
}

/* ── Canonical row ─────────────────────────────────────────────────── */

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
  discovered_via: "construction_data_sources";
  field_mapping_status: "unknown";
  imported_at: string;
  notes: string | null;
};

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
  const filePath =
    "C:/Users/yabis/Desktop/Data Henri 3/us_construction_data_sources.csv";
  const rows = readCsvObjects(filePath);
  console.log(
    `us_construction_data_sources.csv: ${rows.length.toLocaleString()} raw rows`,
  );

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

  const out: SourceRow[] = [];
  const seen = new Set<string>();
  const filtered = {
    badUrl: 0,
    foreign: 0,
    notRelevant: 0,
    dup: 0,
  };

  for (const r of rows) {
    const category = r.Category || "";
    const portal = r.Portal_Name || "";
    const domain = r.Domain || "";
    const url = r.URL || "";
    const type = r.Type || "";
    const source = r.Source || "";

    if (!url || !url.startsWith("http")) {
      filtered.badUrl++;
      continue;
    }
    if (isForeignDomain(hostFromUrl(url))) {
      filtered.foreign++;
      continue;
    }
    if (!isPermitMaterial(category, portal, type, source)) {
      filtered.notRelevant++;
      continue;
    }

    const platform = normPlatform(source) || platformFromUrl(url);
    const state = stateFromDomain(domain) || "US";
    const name = portal.slice(0, 300) || `${source || platform} ${state}`.trim();

    const row: SourceRow = {
      source_key: buildKey(platform, state, null, name, url),
      name,
      state,
      city: null,
      jurisdiction: null,
      endpoint: url,
      source_type: platform,
      auth: "none",
      enabled: false,
      discovered_via: "construction_data_sources",
      field_mapping_status: "unknown",
      imported_at: new Date().toISOString(),
      notes: [
        category && `category=${category}`,
        type && `type=${type}`,
        source && `source=${source}`,
        domain && `domain=${domain}`,
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 1000) || null,
    };
    if (seen.has(row.source_key)) {
      filtered.dup++;
      continue;
    }
    seen.add(row.source_key);
    out.push(row);
  }

  console.log(`\n[construction_data_sources] kept ${out.length.toLocaleString()} rows`);
  console.log(
    `  filtered: badUrl=${filtered.badUrl}, foreign=${filtered.foreign}, notRelevant=${filtered.notRelevant}, dup=${filtered.dup}`,
  );

  if (out.length === 0) {
    console.log("nothing to upsert");
    return;
  }

  console.log(`\nupserting ${out.length} rows...`);
  const res = await upsertBatch("construction_data_sources", out);
  console.log(
    `\n[construction_data_sources] +${res.ok.toLocaleString()} ok, ${res.err} errors`,
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
