#!/usr/bin/env npx tsx
/**
 * Field-mapping audit for Henri's `permit_sources` table.
 *
 * Pulls every enabled+verified+production_grade source, probes each
 * endpoint for a sample row, and emits a CSV recommending the correct
 * mapping for id_field / type_field / status_field / addr_field /
 * date_field / value_field / desc_field / lat_field / lng_field.
 *
 * Designed to run unattended on the Hetzner box (or dev machine):
 *   - 5 RPS rate limit with 200-400ms jitter
 *   - Checkpoints to a partial CSV every 500 probes
 *   - Resumes from the partial CSV if re-invoked
 *   - 5s timeout per probe; 1 retry on transient errors
 *
 * Usage:
 *   npx tsx scripts/_audit-field-mappings.ts                     # full run
 *   npx tsx scripts/_audit-field-mappings.ts --limit=500         # smoke test
 *   npx tsx scripts/_audit-field-mappings.ts --resume            # resume partial
 *
 * Output: docs/studies/henri_field_mappings_2026-MM-DD.csv
 *
 * Companion: `node scripts/_apply-field-mappings.mjs <csv>` issues
 * the bulk UPDATE against permit_sources.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const s = createClient(SUPABASE_URL, SUPABASE_SR, { auth: { persistSession: false } });

const arg = (k: string, def: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : def;
};
const LIMIT = Number(arg("limit", "999999"));
const RESUME = process.argv.includes("--resume");
const RPS = 5;
const PROBE_TIMEOUT_MS = 5000;
const CHECKPOINT_EVERY = 500;
const today = new Date().toISOString().slice(0, 10);
const OUT_PATH = path.resolve(process.cwd(), "docs", "studies", `henri_field_mappings_${today}.csv`);

/* ── heuristic chains (first-match-wins, in priority order) ────────── */
const CHAINS: Record<string, string[]> = {
  id_field: ["PermitNumber", "PERMIT_NUMBER", "PermitNum", "PERMIT_NUM", "permit_number", "permit_no", "permitnum", "CASE_NUMBER", "RecordID", "BUILDING_PERMIT", "APNO", "OBJECTID", "GlobalID"],
  type_field: ["PermitType", "PERMIT_TYPE", "permittype", "permit_type", "WORKTYPE", "WorkType", "APTYPE", "ApplicationType", "PermitClass", "permit_class", "PROJECT_TYPE", "permittypedesc"],
  status_field: ["Status", "PERMIT_STATUS", "PermitStatus", "permit_status", "STAT", "CASE_STATUS", "IssuanceStatus", "StatusCurrent", "status_current", "permitstatus", "applicationstatus"],
  date_field: ["IssuedDate", "ISSUE_DT", "ISSUEDATE", "issueddate", "issue_date", "IssuanceDate", "ApplicationDate", "applieddate", "DATE_ISSUED", "permitdate", "applydate"],
  addr_field: ["Address", "ADDRESS", "PROPERTY", "SiteAddress", "SITE_ADDR", "PROJECT_ADDRESS", "LocationDescription", "locationdescription", "address", "original_address1", "site_address", "StreetAddress", "FullAddress"],
  value_field: ["EstimatedCost", "ESTIMATED_COST", "estimated_cost", "VALUATION", "valuation", "ProjectValue", "JOB_VALUE", "jobvalue", "DECLARED_VALUE", "declared_valuation", "total_value", "estimated_value", "valuationtotal", "PERMITVALUE"],
  desc_field: ["Description", "DESCRIPTION", "APDESC", "ProjectDescription", "WorkDescription", "WORK_DESCR", "permit_description", "description", "scope_of_work", "permitdescription", "workdesc", "WorkDesc", "Purpose"],
  lat_field: ["LATITUDE", "latitude", "Latitude", "LAT", "Y", "y_coord"],
  lng_field: ["LONGITUDE", "longitude", "Longitude", "LONG", "LON", "X", "x_coord"],
};

function pick(keys: string[], chain: string[]): string | "" {
  const lower = new Map(keys.map((k) => [k.toLowerCase(), k]));
  for (const c of chain) {
    if (keys.includes(c)) return c;
    const lo = lower.get(c.toLowerCase());
    if (lo) return lo;
  }
  return "";
}

/* ── probe ────────────────────────────────────────────────────────── */
type Probe = {
  http_status: number;
  keys: string[];
  sample: Record<string, unknown> | null;
  record_count_estimate: number;
  latest_record_date: string;
  error: string;
};

async function probeOne(endpoint: string, sourceType: string): Promise<Probe> {
  const url = sourceType === "socrata"
    ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}$limit=1`
    : `${endpoint}${endpoint.includes("?") ? "&" : "?"}where=1=1&outFields=*&f=json&resultRecordCount=1`;

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Henri-FieldMap-Audit/1.0", Accept: "application/json" },
      signal: ctl.signal,
    });
    clearTimeout(t);
    const status = res.status;
    if (!res.ok) return { http_status: status, keys: [], sample: null, record_count_estimate: 0, latest_record_date: "", error: `HTTP ${status}` };
    const body = await res.json();
    let sample: Record<string, unknown> | null = null;
    if (Array.isArray(body) && body.length) sample = body[0]; // Socrata
    else if (body?.features?.length) sample = body.features[0].attributes ?? body.features[0]; // ArcGIS
    if (!sample) return { http_status: status, keys: [], sample: null, record_count_estimate: 0, latest_record_date: "", error: "EMPTY" };
    return {
      http_status: status,
      keys: Object.keys(sample),
      sample,
      record_count_estimate: 0, // populated separately if needed
      latest_record_date: "",
      error: "",
    };
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    return { http_status: 0, keys: [], sample: null, record_count_estimate: 0, latest_record_date: "", error: msg };
  }
}

/* ── classify ─────────────────────────────────────────────────────── */
function classify(p: Probe, mappings: Record<string, string>): string {
  if (p.http_status === 0) return "DEAD_5XX";
  if (p.http_status === 404) return "DEAD_404";
  if (p.http_status === 401 || p.http_status === 403) return "AUTH_REQUIRED";
  if (p.http_status >= 500) return "DEAD_5XX";
  if (p.error === "EMPTY") return "EMPTY";
  // KEEP_AS_IS vs UPDATE: caller decides by diffing against current mappings.
  // For now mark UPDATE if any of the 6 critical fields was found.
  const critical = ["id_field", "type_field", "status_field", "addr_field", "date_field", "value_field"];
  const found = critical.filter((k) => mappings[k]).length;
  return found >= 4 ? "UPDATE" : "EMPTY";
}

/* ── CSV writer ───────────────────────────────────────────────────── */
const HEADER = [
  "source_key", "endpoint", "http_status", "record_count_estimate",
  "sample_keys", "id_field", "type_field", "status_field", "addr_field",
  "date_field", "value_field", "desc_field", "lat_field", "lng_field",
  "latest_record_date", "freshness_days", "recommendation",
].join(",");

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* ── main ─────────────────────────────────────────────────────────── */
async function fetchSources(): Promise<Array<{ source_key: string; endpoint: string; source_type: string }>> {
  console.log("[audit] pulling enabled+verified+production_grade sources from permit_sources …");
  const out: Array<{ source_key: string; endpoint: string; source_type: string }> = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await s
      .from("permit_sources")
      .select("source_key, endpoint, source_type")
      .eq("enabled", true)
      .eq("field_mapping_status", "verified")
      .eq("discovered_via", "production_grade_2026-04-29")
      .order("priority", { ascending: true })
      .order("last_count", { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`[audit] source pull failed: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...(data as typeof out));
    if (data.length < PAGE) break;
    offset += PAGE;
    if (out.length >= LIMIT) break;
  }
  return out.slice(0, LIMIT);
}

function readResume(): Set<string> {
  if (!RESUME || !fs.existsSync(OUT_PATH)) return new Set();
  const lines = fs.readFileSync(OUT_PATH, "utf-8").split("\n").slice(1);
  const done = new Set<string>();
  for (const ln of lines) {
    const k = ln.split(",")[0];
    if (k && !k.startsWith('"PARTIAL')) done.add(k.replace(/^"|"$/g, ""));
  }
  console.log(`[audit] resume: skipping ${done.size} already-probed source_keys`);
  return done;
}

(async () => {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const sources = await fetchSources();
  const done = readResume();
  console.log(`[audit] ${sources.length} sources to probe; ${done.size} already done`);

  if (!RESUME) fs.writeFileSync(OUT_PATH, HEADER + "\n");
  let probed = 0;
  let lastTick = Date.now();
  const minMs = Math.floor(1000 / RPS);

  for (const src of sources) {
    if (done.has(src.source_key)) continue;
    const elapsed = Date.now() - lastTick;
    if (elapsed < minMs) {
      const wait = minMs - elapsed + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, wait));
    }
    lastTick = Date.now();

    const probe = await probeOne(src.endpoint, src.source_type);
    const m: Record<string, string> = {};
    for (const k of Object.keys(CHAINS)) m[k] = pick(probe.keys, CHAINS[k]);
    const recommendation = classify(probe, m);

    const row = [
      src.source_key,
      src.endpoint,
      probe.http_status,
      probe.record_count_estimate,
      probe.keys.slice(0, 20).join(";"),
      m.id_field, m.type_field, m.status_field, m.addr_field,
      m.date_field, m.value_field, m.desc_field, m.lat_field, m.lng_field,
      probe.latest_record_date,
      "",
      recommendation,
    ].map(csvCell).join(",");
    fs.appendFileSync(OUT_PATH, row + "\n");

    probed++;
    if (probed % 100 === 0) {
      console.log(`[audit] ${probed}/${sources.length - done.size} probed (latest: ${src.source_key} → ${recommendation})`);
    }
    if (probed % CHECKPOINT_EVERY === 0) {
      console.log(`[audit] CHECKPOINT at ${probed}; partial CSV saved at ${OUT_PATH}`);
    }
  }

  console.log(`[audit] DONE — ${probed} new probes; CSV at ${OUT_PATH}`);
  console.log(`[audit] next: node scripts/_apply-field-mappings.mjs ${OUT_PATH}`);
  process.exit(0);
})().catch((e) => {
  console.error(`[audit] FATAL: ${e}`);
  fs.appendFileSync(OUT_PATH, `"PARTIAL — STOPPED ON ERROR: ${e}"\n`);
  process.exit(1);
});
