#!/usr/bin/env npx tsx
/**
 * Coverage-discovery probe for the 18 underserved states.
 *
 * Reads a candidate URL list (JSON), probes each for fresh permit
 * data with the rejection rules below, and emits a CSV that drops
 * directly into permit_sources via _ingest-missing-permits.mjs.
 *
 * Reject rules:
 *   - HTTP 4xx/5xx
 *   - Captcha / Cloudflare-walled (heuristic: body contains 'cf-chl' /
 *     'captcha' / 'verify you are human')
 *   - 401/403/auth required (logged separately as Phase-4 backlog)
 *   - Latest record > 90 days old
 *   - Total record count < 100 (probably abandoned)
 *
 * Candidate-list shape (permit_candidates.json):
 *   [
 *     {
 *       "state": "AK",
 *       "jurisdiction": "Anchorage",
 *       "jurisdiction_type": "city",
 *       "platform": "arcgis",
 *       "endpoint_url": "https://services.arcgis.com/.../FeatureServer/0/query",
 *       "evidence_url": "https://data.muni.org/...",
 *       "terms_url": "https://www.muni.org/...."
 *     },
 *     ...
 *   ]
 *
 * Usage:
 *   npx tsx scripts/_discover-missing-permits.ts                       # default candidate list
 *   npx tsx scripts/_discover-missing-permits.ts --in=<custom.json>    # custom list
 *   npx tsx scripts/_discover-missing-permits.ts --resume              # skip already-probed rows
 *
 * Output: docs/studies/henri_missing_permits_YYYY-MM-DD.csv
 */
import * as fs from "fs";
import * as path from "path";

const arg = (k: string, def: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : def;
};
const RESUME = process.argv.includes("--resume");
const IN_PATH = arg("in", path.resolve(process.cwd(), "scripts", "_permit_candidates.json"));
const RPS = 5;
const PROBE_TIMEOUT_MS = 8000;
const today = new Date().toISOString().slice(0, 10);
const OUT_PATH = path.resolve(process.cwd(), "docs", "studies", `henri_missing_permits_${today}.csv`);

type Candidate = {
  state: string;
  jurisdiction: string;
  jurisdiction_type: "state_aggregator" | "county" | "city" | "special_district";
  platform: string;
  endpoint_url: string;
  evidence_url?: string;
  terms_url?: string;
  notes?: string;
  // data_layer marks the kind of data the endpoint serves. Default: permit.
  // Non-permit values (parcel/assessor/lien/license_roster/planning_pipeline)
  // are needed for the 7 dead-permit states (ME/MS/NH/OK/RI/UT/WV) where
  // we substitute parcel/recorder/lien data for missing permits, plus
  // planning-pipeline trackers like Boise. The discover script probes them
  // identically; the ingest script routes them differently.
  data_layer?: "permit" | "parcel" | "assessor" | "lien" | "license_roster" | "planning_pipeline";
  // _skip true entries are comment-only — the loader passes over them.
  _skip?: boolean;
  _block_comment?: string;
};

const HEADER = [
  "state", "jurisdiction", "jurisdiction_type", "data_layer", "platform", "endpoint_url",
  "http_status", "sample_record_count", "latest_record_date", "freshness_days",
  "total_record_count_estimate", "sample_field_names", "has_owner_name",
  "has_phone", "has_email", "has_lat_lng", "auth_required", "terms_url",
  "evidence_url", "verdict",
].join(",");

function csvCell(v: string | number | boolean): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function loadCandidates(): Candidate[] {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`[discover] candidate list not found: ${IN_PATH}`);
    console.error("Run with --in=<path> to pass a custom list, or seed the default at scripts/_permit_candidates.json");
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(IN_PATH, "utf-8"));
  if (!Array.isArray(data)) {
    console.error("[discover] candidate file must be a JSON array");
    process.exit(2);
  }
  // Filter out _skip entries (block-comment placeholders we use to organize
  // the JSON file visually). Default data_layer to 'permit' if absent.
  return (data as Candidate[]).filter((c) => !c._skip).map((c) => ({
    ...c,
    data_layer: c.data_layer ?? "permit",
  }));
}

function readResumeKeys(): Set<string> {
  if (!RESUME || !fs.existsSync(OUT_PATH)) return new Set();
  const lines = fs.readFileSync(OUT_PATH, "utf-8").split("\n").slice(1);
  const done = new Set<string>();
  for (const ln of lines) {
    const cells = ln.split(",");
    if (cells.length >= 5) done.add(`${cells[0]}|${cells[4]}`);
  }
  return done;
}

/* ── per-platform probe ──────────────────────────────────────────── */
type Probe = {
  http_status: number;
  sample_records: Record<string, unknown>[];
  total_count_estimate: number;
  latest_date: string;
  body_sample: string;
};

async function probe(c: Candidate): Promise<Probe> {
  let url = c.endpoint_url;
  if (c.platform === "arcgis") {
    url += `${url.includes("?") ? "&" : "?"}where=1=1&outFields=*&f=json&resultRecordCount=5`;
  } else if (c.platform === "socrata") {
    url += `${url.includes("?") ? "&" : "?"}$limit=5`;
  } else if (c.platform === "ckan") {
    // CKAN datastore_search expects ?resource_id=... which the candidate
    // URL must already include. We just request 5 rows.
    url += `${url.includes("?") ? "&" : "?"}limit=5`;
  }
  // For non-API platforms (accela/etrakit/cloudpermit/etc.), fall through —
  // the probe will record the HTML response and we mark auth_required.

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Henri-Coverage-Discovery/1.0", Accept: "application/json" },
      signal: ctl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }

    let records: Record<string, unknown>[] = [];
    let total = 0;
    if (parsed) {
      if (Array.isArray(parsed)) {
        records = parsed as Record<string, unknown>[];
      } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { features?: unknown }).features)) {
        const feats = (parsed as { features: Array<{ attributes?: Record<string, unknown> }> }).features;
        records = feats.map((f) => f.attributes ?? f as Record<string, unknown>);
        const meta = parsed as { count?: number };
        total = meta.count ?? 0;
      } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { result?: { records?: unknown } }).result?.records)) {
        // CKAN datastore_search shape
        records = (parsed as { result: { records: Record<string, unknown>[] } }).result.records;
        total = (parsed as { result: { total?: number } }).result.total ?? 0;
      }
    }

    // Latest date — try common keys
    const dateKeys = ["IssuedDate", "ISSUE_DT", "ISSUEDATE", "issueddate", "issue_date", "applieddate", "DATE_ISSUED", "permitdate", "applydate", "issuedate"];
    let latest = "";
    for (const r of records) {
      for (const dk of dateKeys) {
        const v = (r as Record<string, unknown>)[dk];
        if (typeof v === "string" && v > latest) latest = v;
        else if (typeof v === "number" && v > 10**11) {
          // ArcGIS epoch-millis
          const iso = new Date(v).toISOString();
          if (iso > latest) latest = iso;
        }
      }
    }

    return {
      http_status: res.status,
      sample_records: records,
      total_count_estimate: total,
      latest_date: latest,
      body_sample: text.slice(0, 500),
    };
  } catch (e) {
    clearTimeout(t);
    return {
      http_status: 0,
      sample_records: [],
      total_count_estimate: 0,
      latest_date: "",
      body_sample: e instanceof Error ? e.message : String(e),
    };
  }
}

/* ── classify ─────────────────────────────────────────────────────── */
function freshnessDays(latest: string): number {
  if (!latest) return 9999;
  const d = new Date(latest);
  if (isNaN(d.getTime())) return 9999;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

function verdictOf(p: Probe, days: number): string {
  if (p.http_status === 0) return "REJECT_TIMEOUT";
  if (p.http_status === 401 || p.http_status === 403) return "AUTH_REQUIRED";
  if (p.http_status === 404) return "REJECT_404";
  if (p.http_status >= 500) return "REJECT_5XX";
  if (/cf-chl|captcha|verify you are human/i.test(p.body_sample)) return "REJECT_CAPTCHA";
  if (p.sample_records.length === 0) return "REJECT_EMPTY";
  if (days > 90) return "REJECT_STALE";
  if (p.total_count_estimate > 0 && p.total_count_estimate < 100) return "REJECT_TINY";
  return "ACCEPT";
}

function detectFields(records: Record<string, unknown>[]): { ownerName: boolean; phone: boolean; email: boolean; latLng: boolean; fields: string[] } {
  const keys = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) keys.add(k);
  const lc = [...keys].map((k) => k.toLowerCase());
  return {
    ownerName: lc.some((k) => /^owner|owner_?name|applicant_?name|ownername|applicantname/.test(k)),
    phone: lc.some((k) => /phone|cell|mobile/.test(k)),
    email: lc.some((k) => /email|e_?mail|emailaddress/.test(k)),
    latLng: lc.some((k) => /^lat|latitude/.test(k)) && lc.some((k) => /^lon|longitude/.test(k)),
    fields: [...keys].slice(0, 30),
  };
}

/* ── main ─────────────────────────────────────────────────────────── */
(async () => {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const candidates = loadCandidates();
  const done = readResumeKeys();
  console.log(`[discover] ${candidates.length} candidates; ${done.size} already done`);
  if (!RESUME) fs.writeFileSync(OUT_PATH, HEADER + "\n");

  const minMs = Math.floor(1000 / RPS);
  let lastTick = Date.now();
  let probed = 0;

  for (const c of candidates) {
    const key = `${c.state}|${c.endpoint_url}`;
    if (done.has(key)) continue;
    const elapsed = Date.now() - lastTick;
    if (elapsed < minMs) {
      const wait = minMs - elapsed + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, wait));
    }
    lastTick = Date.now();

    const p = await probe(c);
    const days = freshnessDays(p.latest_date);
    const v = verdictOf(p, days);
    const f = detectFields(p.sample_records);
    const authRequired = (v === "AUTH_REQUIRED" || ["accela", "tyler_etrakit", "cloudpermit", "opengov", "citizenserve", "mygovonline", "bs_and_a", "viewpoint", "smartgov"].includes(c.platform))
      ? "scrape"
      : "no";

    const row = [
      c.state, c.jurisdiction, c.jurisdiction_type, c.data_layer ?? "permit", c.platform, c.endpoint_url,
      p.http_status, p.sample_records.length, p.latest_date, days,
      p.total_count_estimate, f.fields.join(";"),
      f.ownerName, f.phone, f.email, f.latLng,
      authRequired, c.terms_url ?? "", c.evidence_url ?? "", v,
    ].map(csvCell).join(",");
    fs.appendFileSync(OUT_PATH, row + "\n");

    probed++;
    if (probed % 25 === 0) console.log(`[discover] ${probed}/${candidates.length} probed (latest: ${c.state}/${c.jurisdiction} → ${v})`);
  }

  console.log(`[discover] DONE — ${probed} new probes; CSV at ${OUT_PATH}`);
  console.log(`[discover] next: node scripts/_ingest-missing-permits.mjs ${OUT_PATH}`);
  process.exit(0);
})().catch((e) => {
  console.error(`[discover] FATAL: ${e}`);
  fs.appendFileSync(OUT_PATH, `"PARTIAL — STOPPED ON ERROR: ${e}"\n`);
  process.exit(1);
});
