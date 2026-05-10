#!/usr/bin/env node
/**
 * Audit field-mapping correctness across all `permit_sources` rows where
 * `field_mapping_status='verified' AND discovered_via='production_grade_2026-04-29'`.
 *
 * Reads `permit_sources` via PostgREST (auth: SUPABASE_SERVICE_ROLE_KEY from
 * .env.local — no extra env vars needed). Probes each endpoint for ONE row,
 * extracts response keys, and recommends the canonical mapping for the 6
 * Henri-side normalizer fields plus 3 geo/desc bonus fields.
 *
 * Usage:
 *   node scripts/_audit-field-mappings.mjs                # default output path
 *   node scripts/_audit-field-mappings.mjs my-out.csv     # explicit path
 *
 * Flags via env:
 *   AUDIT_LIMIT=100      cap probes (smoke-test mode)
 *   AUDIT_RESUME=1       skip rows whose source_key already appears in OUT
 *
 * SIGINT-safe: appends a `PARTIAL — STOPPED AT N OF M` footer if interrupted.
 *
 * Rate limits: 200-400ms random jitter between probe START times. With a
 * 5s per-probe timeout this stays under the 5 RPS ceiling the brief
 * specifies (peak ≈ 3 RPS, average closer to 1-2 RPS once timeouts factor in).
 */
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadEnv({ path: resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT_PATH = process.argv[2] || "henri_field_mappings_2026-05-08.csv";
const AUDIT_LIMIT = process.env.AUDIT_LIMIT
  ? Number(process.env.AUDIT_LIMIT)
  : Number.POSITIVE_INFINITY;
const AUDIT_RESUME = process.env.AUDIT_RESUME === "1";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(2);
}

// Heuristic dictionaries — first match wins, case-insensitive.
const MAPPING_RULES = {
  id_field: [
    "PermitNumber", "PERMIT_NUMBER", "PermitNum", "PERMIT_NUM",
    "CASE_NUMBER", "RecordID", "BUILDING_PERMIT", "permit_number",
    "permitnumber", "permitnum", "OBJECTID", "GlobalID",
  ],
  type_field: [
    "PermitType", "PERMIT_TYPE", "WORKTYPE", "WorkType", "APTYPE",
    "ApplicationType", "PermitClass", "PROJECT_TYPE", "permit_type",
    "permit_class", "work_type", "application_type",
  ],
  status_field: [
    "Status", "PERMIT_STATUS", "PermitStatus", "STAT", "CASE_STATUS",
    "IssuanceStatus", "StatusCurrent", "status", "status_current",
    "current_status",
  ],
  date_field: [
    "IssuedDate", "ISSUE_DT", "ISSUEDATE", "IssuanceDate",
    "ApplicationDate", "DATE_ISSUED", "issue_date", "issued_date",
    "date_issued", "issuance_date",
  ],
  addr_field: [
    "Address", "ADDRESS", "PROPERTY", "SiteAddress", "SITE_ADDR",
    "PROJECT_ADDRESS", "LocationDescription", "locationdescription",
    "address", "site_address", "project_address", "full_address",
    "originaladdress1", "original_address1",
  ],
  value_field: [
    "EstimatedCost", "ESTIMATED_COST", "VALUATION", "ProjectValue",
    "JOB_VALUE", "DECLARED_VALUE", "total_value", "estimated_value",
    "estimated_cost", "valuation", "declared_valuation",
    "estimated_project_cost", "estprojectcost",
  ],
  desc_field: [
    "Description", "DESCRIPTION", "APDESC", "ProjectDescription",
    "WorkDescription", "WORK_DESCR", "permit_description",
    "description", "work_description", "project_description",
  ],
  lat_field: [
    "LATITUDE", "latitude", "LAT", "Y", "y_coord",
  ],
  lng_field: [
    "LONGITUDE", "longitude", "LONG", "LON", "X", "x_coord",
  ],
};

function pickField(keys, candidates) {
  const lowerKeys = keys.map((k) => k.toLowerCase());
  for (const cand of candidates) {
    const idx = lowerKeys.indexOf(cand.toLowerCase());
    if (idx >= 0) return keys[idx];
  }
  return "";
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function isArcGISLike(endpoint, source_type) {
  if (source_type && source_type.toLowerCase() === "arcgis") return true;
  return /\/(FeatureServer|MapServer)(\/\d+)?\/?(\?|$|query)/i.test(endpoint);
}

function buildProbeURL(endpoint, source_type) {
  const arcgis = isArcGISLike(endpoint, source_type);
  if (arcgis) {
    // Strip trailing /query and any query string
    let base = endpoint
      .replace(/\?.*$/, "")
      .replace(/\/query\/?$/i, "")
      .replace(/\/+$/, "");
    return `${base}/query?where=1%3D1&outFields=*&f=json&resultRecordCount=1&returnGeometry=false`;
  }
  // Socrata
  const sep = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${sep}$limit=1`;
}

async function probeOne(source) {
  const { source_key, endpoint, source_type } = source;
  const probeUrl = buildProbeURL(endpoint, source_type);
  const arcgis = isArcGISLike(endpoint, source_type);

  let status = 0;
  let body = null;
  let errMsg = "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(probeUrl, {
      headers: { "User-Agent": "Henri-FieldMap-Audit/1.0" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    status = r.status;
    const text = await r.text();
    if (r.ok && text) {
      try { body = JSON.parse(text); } catch { errMsg = "non-JSON response"; }
    } else if (!r.ok) {
      errMsg = text.slice(0, 120);
    }
  } catch (e) {
    if (e.name === "AbortError") { status = 599; errMsg = "timeout"; }
    else { status = 0; errMsg = (e?.message || String(e)).slice(0, 120); }
  } finally {
    clearTimeout(timer);
  }

  // ArcGIS sometimes returns 200 with {"error": {"code": 400}}.
  if (body && body.error) {
    const code = body.error.code || 0;
    if (typeof code === "number" && code >= 400) {
      // Treat as error condition; preserve HTTP status for honesty but
      // the recommendation logic will downgrade.
      errMsg = `arcgis_error_${code}: ${body.error.message || ""}`.slice(0, 120);
      body = null;
    }
  }

  // Extract one sample row's keys
  let keys = [];
  let recordCount = 0;
  let sampleRow = null;
  if (body) {
    if (arcgis) {
      const features = Array.isArray(body.features) ? body.features : [];
      recordCount = features.length;
      if (features.length > 0 && features[0].attributes) {
        sampleRow = features[0].attributes;
        keys = Object.keys(sampleRow);
      }
    } else {
      if (Array.isArray(body) && body.length > 0) {
        recordCount = body.length;
        sampleRow = body[0];
        keys = Object.keys(sampleRow);
      }
    }
  }

  // Apply heuristics
  const mapping = {};
  for (const [field, candidates] of Object.entries(MAPPING_RULES)) {
    mapping[field] = pickField(keys, candidates);
  }

  // Latest-record date — pull the actual value of the date field we picked
  let latestDate = "";
  let freshnessDays = "";
  if (mapping.date_field && sampleRow) {
    const raw = sampleRow[mapping.date_field];
    if (raw != null && raw !== "") {
      let d = null;
      if (typeof raw === "number") d = new Date(raw);
      else if (typeof raw === "string") d = new Date(raw);
      if (d && !isNaN(d.getTime())) {
        latestDate = d.toISOString().slice(0, 10);
        freshnessDays = Math.floor((Date.now() - d.getTime()) / 86400000);
      }
    }
  }

  // Recommendation classification
  let recommendation;
  if (status === 401 || status === 403) recommendation = "AUTH_REQUIRED";
  else if (status === 404) recommendation = "DEAD_404";
  else if (status === 0 || status === 599 || status >= 500) recommendation = "DEAD_5XX";
  else if (!body || keys.length === 0) recommendation = "EMPTY";
  else if (typeof freshnessDays === "number" && freshnessDays > 90) recommendation = "STALE_>90d";
  else recommendation = "UPDATE";

  return {
    source_key,
    endpoint,
    http_status: status,
    record_count_estimate: recordCount,
    sample_keys: keys.slice(0, 30).join("|"),
    id_field: mapping.id_field,
    type_field: mapping.type_field,
    status_field: mapping.status_field,
    addr_field: mapping.addr_field,
    date_field: mapping.date_field,
    value_field: mapping.value_field,
    desc_field: mapping.desc_field,
    lat_field: mapping.lat_field,
    lng_field: mapping.lng_field,
    latest_record_date: latestDate,
    freshness_days: freshnessDays === "" ? "" : String(freshnessDays),
    recommendation,
  };
}

async function fetchEndpoints() {
  // PostgREST returns a max of 1000 rows per request by default. We
  // paginate via the Range header until the response is shorter than
  // the page size (server may also cap below 1000 — handle both).
  const PAGE = 1000;
  const baseParams = {
    field_mapping_status: "eq.verified",
    discovered_via: "eq.production_grade_2026-04-29",
    enabled: "is.true",
    select: "source_key,endpoint,source_type",
    order: "priority.asc.nullslast,last_count.desc.nullslast",
  };
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams(baseParams);
    const url = `${SUPABASE_URL}/rest/v1/permit_sources?${params}`;
    const r = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Range: `${offset}-${offset + PAGE - 1}`,
        "Range-Unit": "items",
      },
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`permit_sources fetch failed at offset ${offset}: ${r.status} ${t.slice(0, 300)}`);
    }
    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE) break;
    offset += page.length;
  }
  return all;
}

async function loadResumeKeys(path) {
  if (!AUDIT_RESUME || !fs.existsSync(path)) return new Set();
  const seen = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    const firstComma = line.indexOf(",");
    if (firstComma > 0) {
      let k = line.slice(0, firstComma);
      // strip surrounding quotes if present
      if (k.startsWith('"') && k.endsWith('"')) k = k.slice(1, -1).replace(/""/g, '"');
      seen.add(k);
    }
  }
  return seen;
}

const HEADER =
  "source_key,endpoint,http_status,record_count_estimate,sample_keys," +
  "id_field,type_field,status_field,addr_field,date_field,value_field," +
  "desc_field,lat_field,lng_field,latest_record_date,freshness_days,recommendation";

async function main() {
  const sources = await fetchEndpoints();
  console.error(`[audit] fetched ${sources.length} permit_sources rows`);

  const resumeKeys = await loadResumeKeys(OUT_PATH);
  if (resumeKeys.size > 0) {
    console.error(`[audit] resume mode: ${resumeKeys.size} already in ${OUT_PATH}`);
  }

  const outAppend = AUDIT_RESUME && fs.existsSync(OUT_PATH);
  const out = fs.createWriteStream(OUT_PATH, { flags: outAppend ? "a" : "w" });
  if (!outAppend) out.write(HEADER + "\n");

  let n = 0;
  let stopped = false;
  const stopOn = (sig) => {
    stopped = true;
    console.error(`[audit] received ${sig} — flushing partial output`);
  };
  process.on("SIGINT", () => stopOn("SIGINT"));
  process.on("SIGTERM", () => stopOn("SIGTERM"));

  const total = sources.length;
  for (const s of sources) {
    if (stopped) break;
    if (n >= AUDIT_LIMIT) break;
    if (resumeKeys.has(s.source_key)) continue;
    let r;
    try {
      r = await probeOne(s);
    } catch (e) {
      r = {
        source_key: s.source_key,
        endpoint: s.endpoint,
        http_status: 0,
        record_count_estimate: 0,
        sample_keys: "",
        id_field: "", type_field: "", status_field: "", addr_field: "",
        date_field: "", value_field: "", desc_field: "", lat_field: "", lng_field: "",
        latest_record_date: "", freshness_days: "",
        recommendation: "DEAD_5XX",
      };
    }
    out.write(
      [
        r.source_key, r.endpoint, r.http_status, r.record_count_estimate,
        r.sample_keys, r.id_field, r.type_field, r.status_field, r.addr_field,
        r.date_field, r.value_field, r.desc_field, r.lat_field, r.lng_field,
        r.latest_record_date, r.freshness_days, r.recommendation,
      ].map(csvEscape).join(",") + "\n",
    );
    n++;
    if (n % 500 === 0) {
      console.error(
        `[audit] ${new Date().toISOString()} checkpoint ${n}/${total} — last ${r.recommendation} ${r.source_key}`,
      );
    }
    // Jitter 200-400ms
    await new Promise((res) => setTimeout(res, 200 + Math.random() * 200));
  }

  if (stopped) {
    out.write(`PARTIAL — STOPPED AT ${n} OF ${total}\n`);
  }
  out.end();
  console.error(`[audit] done. probed=${n}/${total} → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error("[audit] fatal:", e);
  process.exit(1);
});
