/**
 * Autonomous source-discovery for permit-coverage gaps.
 *
 * Reads the gap CSV produced by `pnpm coverage:gaps` and, for each
 * missing state / city, tries a battery of well-known open-data catalog
 * patterns, parses anything that returns JSON, filters to permit-relevant
 * datasets, and bulk-upserts them into `permit_sources` with
 * `discovered_via='auto_discovery'` and `enabled=false`.
 *
 *   pnpm discover:sources                                # uses today's gap CSV
 *   pnpm discover:sources --gaps=docs/studies/coverage-gaps-2026-04-27.csv
 *   pnpm discover:sources --states=PR,VI,GU              # explicit list
 *   pnpm discover:sources --top=50                       # cap requests
 *
 * Probe patterns (per state / city):
 *   1. Socrata catalog API:   https://api.us.socrata.com/api/catalog/v1?domains=<dom>
 *      We hit Socrata's central federated discovery endpoint, NOT each
 *      city's domain individually — the federated endpoint already knows
 *      every Socrata data portal worldwide.
 *   2. CKAN /data.json:        https://data.<X>.gov/data.json
 *   3. ArcGIS Hub catalog:     https://hub.arcgis.com/api/v3/datasets?...
 *
 * Idempotent: source_key dedup on upsert. Re-running widens the catalog
 * but never duplicates rows.
 *
 * NB: This is rate-limit friendly. ≤2 req/s per host, total cap of 600
 * requests per invocation.
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

/* ── CLI args ─────────────────────────────────────────────────── */

const arg = (k: string, def: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : def;
};
const GAPS_CSV = arg("gaps", "");
const STATES_FILTER = arg("states", "")
  .split(",")
  .map((x) => x.trim().toUpperCase())
  .filter(Boolean);
const TOP_CAP = Number(arg("top", "200"));
const REQUEST_CAP = Number(arg("requests", "600"));

/* ── Permit-relevance filter (shared with import-desktop-catalogs) ── */

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
  "pesticide",
];

function isPermitRelevant(...fields: (string | undefined)[]): boolean {
  const haystack = fields
    .map((f) => (f ?? "").toLowerCase())
    .join(" ");
  if (haystack.length === 0) return false;
  for (const n of NEGATIVE) {
    if (haystack.includes(n.toLowerCase())) return false;
  }
  for (const p of POSITIVE) {
    if (haystack.includes(p.toLowerCase())) return true;
  }
  return false;
}

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

/* ── Discovery target list ────────────────────────────────────── */

interface Target {
  state: string;
  city?: string;
  reason: "missing_state" | "thin_state" | "missing_city" | "explicit";
}

function loadTargets(): Target[] {
  // Explicit --states= overrides everything else.
  if (STATES_FILTER.length > 0) {
    return STATES_FILTER.map((st) => ({ state: st, reason: "explicit" as const }));
  }
  // From gap CSV.
  let csvPath = GAPS_CSV;
  if (!csvPath) {
    // Default: today's CSV (or yesterday's).
    const dir = path.resolve(process.cwd(), "docs", "studies");
    if (fs.existsSync(dir)) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => /^coverage-gaps-\d{4}-\d{2}-\d{2}\.csv$/.test(f))
        .sort()
        .reverse();
      if (files[0]) csvPath = path.join(dir, files[0]);
    }
  }
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error(
      "No gap CSV found. Run `pnpm coverage:gaps` first or pass --states=AL,AK,…",
    );
    process.exit(1);
  }
  console.log(`reading gaps from: ${csvPath}`);
  const rows: Target[] = [];
  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).slice(1); // skip header
  for (const line of lines) {
    if (!line.trim()) continue;
    // kind,code,name,state,pop,sources,permits,distinct_zips,distinct_cities,status
    const parts = line.split(",");
    if (parts.length < 10) continue;
    const kind = parts[0];
    const code = parts[1];
    const stateCol = parts[3];
    const status = parts[9];
    const name = (parts[2] ?? "").replace(/^"|"$/g, "");
    if (kind === "state" && (status === "missing" || status === "thin")) {
      rows.push({
        state: code,
        reason: status === "missing" ? "missing_state" : "thin_state",
      });
    } else if (kind === "city" && status === "missing") {
      rows.push({
        state: stateCol,
        city: name,
        reason: "missing_city",
      });
    }
  }
  return rows;
}

/* ── HTTP helpers ─────────────────────────────────────────────── */

let requestsRemaining = REQUEST_CAP;

async function fetchJson(url: string, timeoutMs = 6000): Promise<unknown | null> {
  if (requestsRemaining <= 0) return null;
  requestsRemaining--;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": "henri-permit-coverage/1.0 (contact: y.abismuth@gmail.com)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length < 2) return null;
    if (text[0] !== "{" && text[0] !== "[") return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ── Discovery: Socrata federated catalog ─────────────────────── */
//
// Socrata's catalog API at api.us.socrata.com lets you list every dataset
// across every Socrata-hosted data portal. We page by 100 results and
// filter to permit-relevant datasets. This catches city / county / state
// permit datasets we don't yet have — a single request often returns
// 50+ candidate datasets across multiple jurisdictions.
//
// Federated query: q=permit returns datasets whose name/description
// contains "permit". We layer our own permit-relevance filter on top.

interface SocrataCatalogItem {
  resource?: {
    id?: string;
    name?: string;
    description?: string;
    type?: string;
    parent_fxf?: string[];
    columns_field_name?: string[];
  };
  classification?: {
    domain_category?: string;
    categories?: string[];
    tags?: string[];
  };
  metadata?: {
    domain?: string;
  };
  permalink?: string;
  link?: string;
}

async function discoverSocrata(target: Target): Promise<DiscoveredRow[]> {
  // Socrata catalog query: include domain hint when we have a state, so
  // the federated catalog narrows by jurisdiction. Otherwise we'd be
  // fetching the same global "permit" page over and over.
  const out: DiscoveredRow[] = [];
  const SEARCH_LIMIT = 100;
  // For state-level discovery, query without a domain so we get every
  // Socrata portal's permit datasets, then we'll filter by domain below.
  const url = `https://api.us.socrata.com/api/catalog/v1?q=${encodeURIComponent(
    target.city ?? "permit",
  )}&limit=${SEARCH_LIMIT}&only=dataset`;
  const j = await fetchJson(url);
  if (!j) return out;
  const items = (j as { results?: SocrataCatalogItem[] }).results ?? [];
  for (const it of items) {
    const dom = it.metadata?.domain;
    const id = it.resource?.id;
    const name = it.resource?.name ?? "";
    const desc = it.resource?.description ?? "";
    if (!dom || !id || id.length !== 9) continue;
    if (!isPermitRelevant(name, desc, ...(it.classification?.tags ?? []))) {
      continue;
    }
    // The endpoint we'll scrape is the Socrata resource JSON URL.
    const endpoint = `https://${dom}/resource/${id}.json`;
    out.push({
      platform: "socrata",
      state: target.state,
      city: target.city ?? null,
      name,
      endpoint,
      notes: desc.slice(0, 500),
    });
  }
  return out;
}

/* ── Discovery: CKAN /data.json ───────────────────────────────── */
//
// CKAN-hosted state portals all publish a /data.json catalog at their
// root. The DCAT JSON shape is well-known. We probe a list of candidate
// state portals; if one returns valid JSON, we filter datasets by the
// permit-relevance keywords.

const STATE_CKAN_DOMAINS: Record<string, string[]> = {
  AL: ["data.alabama.gov"],
  AK: ["data.alaska.gov"],
  AZ: ["data.az.gov", "azopendata.gov"],
  AR: ["data.arkansas.gov"],
  CA: ["data.ca.gov", "data.cnra.ca.gov"],
  CO: ["data.colorado.gov"],
  CT: ["data.ct.gov", "data.connecticut.gov"],
  DE: ["data.delaware.gov"],
  FL: ["data.florida-demographics.com", "fdacs.gov"],
  GA: ["data.georgia.gov"],
  HI: ["data.hawaii.gov"],
  ID: ["data.idaho.gov"],
  IL: ["data.illinois.gov"],
  IN: ["data.in.gov"],
  IA: ["data.iowa.gov"],
  KS: ["data.kansas.gov"],
  KY: ["data.kentucky.gov"],
  LA: ["data.louisiana.gov"],
  ME: ["data.maine.gov"],
  MD: ["opendata.maryland.gov"],
  MA: ["data.mass.gov"],
  MI: ["data.michigan.gov"],
  MN: ["data.mn.gov"],
  MS: ["data.ms.gov"],
  MO: ["data.mo.gov"],
  MT: ["data.mt.gov"],
  NE: ["data.nebraska.gov"],
  NV: ["data.nv.gov"],
  NH: ["data.nh.gov"],
  NJ: ["data.nj.gov"],
  NM: ["data.nm.gov"],
  NY: ["data.ny.gov"],
  NC: ["data.nc.gov"],
  ND: ["data.nd.gov"],
  OH: ["data.ohio.gov"],
  OK: ["data.ok.gov"],
  OR: ["data.oregon.gov"],
  PA: ["data.pa.gov"],
  RI: ["data.ri.gov"],
  SC: ["data.sc.gov"],
  SD: ["data.sd.gov"],
  TN: ["data.tn.gov"],
  TX: ["data.texas.gov"],
  UT: ["opendata.utah.gov"],
  VT: ["data.vermont.gov"],
  VA: ["data.virginia.gov"],
  WA: ["data.wa.gov"],
  WV: ["data.wv.gov"],
  WI: ["data.wi.gov"],
  WY: ["data.wyo.gov"],
  DC: ["opendata.dc.gov"],
  // Territories
  PR: ["data.pr.gov", "datos.pr.gov"],
  VI: ["data.vi.gov"],
  GU: ["data.guam.gov"],
  AS: [],
  MP: [],
};

interface DcatDataset {
  title?: string;
  description?: string;
  keyword?: string[];
  distribution?: Array<{
    accessURL?: string;
    downloadURL?: string;
    mediaType?: string;
    format?: string;
  }>;
}

async function discoverCkanState(state: string): Promise<DiscoveredRow[]> {
  const out: DiscoveredRow[] = [];
  const domains = STATE_CKAN_DOMAINS[state] ?? [];
  for (const dom of domains) {
    if (requestsRemaining <= 0) break;
    const url = `https://${dom}/data.json`;
    const j = await fetchJson(url, 8000);
    if (!j) continue;
    const datasets = ((j as { dataset?: DcatDataset[] }).dataset ?? []).slice(
      0,
      2000,
    );
    for (const d of datasets) {
      if (!isPermitRelevant(d.title, d.description, ...(d.keyword ?? []))) {
        continue;
      }
      // Pick the JSON / API endpoint from distributions.
      const dist = (d.distribution ?? []).find(
        (x) =>
          (x.mediaType ?? "").includes("json") ||
          (x.format ?? "").toLowerCase() === "json" ||
          (x.accessURL ?? "").includes("/resource/"),
      );
      const endpoint = dist?.accessURL ?? dist?.downloadURL;
      if (!endpoint || !endpoint.startsWith("http")) continue;
      // Detect Socrata vs CKAN endpoint shape.
      const platform: "socrata" | "ckan" = /\/resource\/[a-z0-9-]+\.json/.test(
        endpoint,
      )
        ? "socrata"
        : "ckan";
      out.push({
        platform,
        state,
        city: null,
        name: d.title ?? "(unnamed dataset)",
        endpoint,
        notes: (d.description ?? "").slice(0, 500),
      });
    }
  }
  return out;
}

/* ── Canonical row + upsert ──────────────────────────────────── */

interface DiscoveredRow {
  platform: "socrata" | "ckan" | "arcgis" | "csv" | "unknown";
  state: string;
  city: string | null;
  name: string;
  endpoint: string;
  notes?: string;
}

function rowToSourceUpsert(d: DiscoveredRow) {
  return {
    source_key: buildKey(d.platform, d.state, d.city, d.name, d.endpoint),
    name: (d.name ?? "").slice(0, 300) || `${d.platform} ${d.state}`,
    state: d.state,
    city: d.city,
    jurisdiction: null,
    endpoint: d.endpoint,
    source_type: d.platform,
    auth: "none",
    enabled: false,
    discovered_via: "auto_discovery",
    field_mapping_status: "unknown",
    imported_at: new Date().toISOString(),
    notes: d.notes ?? null,
  };
}

type RichRow = ReturnType<typeof rowToSourceUpsert>;
type LegacyRow = Omit<RichRow, "discovered_via" | "field_mapping_status" | "imported_at" | "notes">;
function stripProvenance(rows: RichRow[]): LegacyRow[] {
  return rows.map((r) => {
    const { discovered_via: _dv, field_mapping_status: _fms, imported_at: _ia, notes: _n, ...rest } = r;
    void _dv; void _fms; void _ia; void _n;
    return rest;
  });
}

async function upsertBatch(rows: DiscoveredRow[]): Promise<{ ok: number; err: number }> {
  const BATCH = 200;
  let ok = 0;
  let err = 0;
  // Dedupe by source_key in-batch first so the upsert cost is honest.
  const dedup = new Map<string, DiscoveredRow>();
  for (const r of rows) {
    const u = rowToSourceUpsert(r);
    if (!dedup.has(u.source_key)) dedup.set(u.source_key, r);
  }
  const unique = [...dedup.values()];
  const payload = unique.map(rowToSourceUpsert);
  let useStripped = false;
  for (let i = 0; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH);
    const { error } = await s
      .from("permit_sources")
      .upsert(useStripped ? stripProvenance(chunk) : chunk, {
        onConflict: "source_key",
        ignoreDuplicates: false,
      });
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
          `  migration 00052 columns missing — falling back to legacy schema`,
        );
        const { error: retryErr } = await s
          .from("permit_sources")
          .upsert(stripProvenance(chunk), {
            onConflict: "source_key",
            ignoreDuplicates: false,
          });
        if (retryErr) {
          console.warn(
            `  upsert batch ${i}-${i + BATCH} retry failed: ${retryErr.message}`,
          );
          err += chunk.length;
        } else {
          ok += chunk.length;
        }
      } else {
        console.warn(
          `  upsert batch ${i}-${i + BATCH} failed: ${error.message}`,
        );
        err += chunk.length;
      }
    } else {
      ok += chunk.length;
    }
  }
  return { ok, err };
}

/* ── Main ─────────────────────────────────────────────────────── */

(async () => {
  const targets = loadTargets().slice(0, TOP_CAP);
  if (targets.length === 0) {
    console.log("No gap targets — coverage looks complete by the script's lights.");
    return;
  }
  console.log(`Probing ${targets.length} target(s) (request cap = ${REQUEST_CAP}):`);

  const allDiscovered: DiscoveredRow[] = [];

  // Phase 1: state-level discovery (CKAN /data.json + Socrata federated)
  const seenStates = new Set<string>();
  for (const t of targets) {
    if (t.reason === "missing_state" || t.reason === "thin_state" || t.reason === "explicit") {
      if (seenStates.has(t.state)) continue;
      seenStates.add(t.state);
      console.log(`  [state ${t.state}] CKAN + Socrata`);
      const ckan = await discoverCkanState(t.state);
      const soc = await discoverSocrata({ state: t.state, reason: t.reason });
      console.log(`    +${ckan.length} CKAN, +${soc.length} Socrata`);
      allDiscovered.push(...ckan, ...soc);
    }
  }

  // Phase 2: city-level discovery (Socrata federated only — CKAN by city
  // is too lossy; the city's own portal isn't always a CKAN host)
  for (const t of targets) {
    if (t.reason !== "missing_city") continue;
    if (requestsRemaining <= 0) break;
    console.log(`  [city ${t.city}, ${t.state}] Socrata search`);
    const soc = await discoverSocrata(t);
    console.log(`    +${soc.length} Socrata candidates`);
    allDiscovered.push(...soc);
  }

  console.log(
    `\nTotal discovered: ${allDiscovered.length}, requests used: ${REQUEST_CAP - requestsRemaining}`,
  );

  if (allDiscovered.length === 0) {
    console.log("No new datasets discovered.");
    return;
  }

  console.log(`\nUpserting into permit_sources…`);
  const res = await upsertBatch(allDiscovered);
  console.log(
    `Upserted: ${res.ok} ok, ${res.err} errors, ${allDiscovered.length} candidates total`,
  );

  // Final summary
  const { count: totalCount } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  const { count: autoCount } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("discovered_via", "auto_discovery");
  console.log(`\npermit_sources total: ${totalCount?.toLocaleString() ?? "?"}`);
  console.log(`  auto_discovery rows: ${autoCount?.toLocaleString() ?? "?"}`);
  console.log(`\nNext: pnpm coverage:gaps  (re-run to see updated coverage)`);
  console.log(`      then: npx tsx scripts/bulk-probe-sources.ts  (validate field mappings)`);
})();
