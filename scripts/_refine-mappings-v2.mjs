#!/usr/bin/env node
/**
 * Refinement pass v2 — re-probe the 873 already-mapped rows, tighten
 * `address_field` (situs vs mailing) and `date_field` (lifecycle vs
 * row metadata), and emit a diff CSV for the apply script.
 *
 * SAFETY: never worsen. If the refined heuristic returns NULL but the
 * current DB value is non-null and arguably reasonable (only Tier C
 * available, or current is in Tier B), keep the current mapping.
 *
 * id/type/status/value/desc/lat/lng pass through untouched — the
 * refinement is targeted at addr_field + date_field only.
 *
 * Usage:
 *   node scripts/_refine-mappings-v2.mjs                                # default OUT
 *   node scripts/_refine-mappings-v2.mjs out.csv                        # explicit OUT
 *   AUDIT_LIMIT=20 node scripts/_refine-mappings-v2.mjs                 # smoke
 *   AUDIT_RESUME=1 node scripts/_refine-mappings-v2.mjs                 # resume
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
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT_PATH = process.argv[2] || "henri_field_mappings_REFINED_2026-05-09.csv";
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

// ── Address heuristic — tiered, situs-preferred ─────────────────────
// Tier A patterns match column names like SITE_ADDR, SiteAddress,
// situs_address, PROPERTY, ProjectAddress, PHY_ADDR1, originaladdress1,
// PERMIT_ADDRESS — all of which mean "the actual property address."
const ADDR_TIER_A_PATTERNS = [
  /^site_?addr(?:ess)?(?:_?\d)?$/i,
  /^situs(?:_?address)?$/i,
  /^prop(?:erty)?(?:_?addr(?:ess)?)?$/i,
  /^project_?addr(?:ess)?$/i,
  /^permit_?addr(?:ess)?$/i,
  /^phy(?:sical)?_?addr(?:ess)?(?:_?\d)?$/i,
  /^location(?:description)?$/i,
  /^location_?addr(?:ess)?$/i,
  /^job_?(?:site|address)$/i,
  /^address_?location$/i,
  /^originaladdress\d?$/i,
  /^original_?address\d?$/i,
  /^primaryaddress$/i,
];
// Tier B — generic. Only used when Tier A is empty.
const ADDR_TIER_B_PATTERNS = [
  /^address$/i,
  /^addr$/i,
  /^address_?\d$/i,
  /^addr_?\d$/i,
  /^address_?line_?1$/i,
  /^full_?address$/i,
  /^street_?address$/i,
];
// Tier C — REJECT. Owner / mailing / taxpayer / contractor addresses
// route leads to the wrong physical location and must never be picked.
const ADDR_TIER_C_PATTERNS = [
  /^owner_?addr(?:ess)?(?:_?\d)?$/i,
  /^owner_?mailing(?:_?addr(?:ess)?)?$/i,
  /^mailing(?:_?addr(?:ess)?)?(?:_?\d)?$/i,
  /^mail_?addr(?:ess)?(?:_?\d)?$/i,
  /^maildest$/i,
  /^maildestination$/i,
  /^taxpayer(?:_?addr(?:ess)?)?(?:_?\d)?$/i,
  /^tax_?addr(?:ess)?$/i,
  /^contractor_?addr(?:ess)?$/i,
  /^applicant_?addr(?:ess)?$/i,
  /^billing_?addr(?:ess)?$/i,
];

// ── Date heuristic — accept-list + reject-list ──────────────────────
// ACCEPT: column name contains a permit-lifecycle term.
const DATE_ACCEPT_RE =
  /^(?:permit_?|app_?|appl_?)?(?:issue[ds]?|filed?|filing|applied|application|approval|approved|effective|complete[d]?|finaled|permit)_?(?:date|dt)$/i;
// Also accept these specific lifecycle column names with no date suffix.
const DATE_ACCEPT_EXACT = new Set([
  "issuedate", "issdate", "issd", "issue_dt", "issuedt",
  "applieddate", "applied_dt", "appdate", "app_dt", "appliedon",
  "datefiled", "filedate", "filed_on",
  "permitdate", "permit_date", "permitdt", "permit_dt",
  "approvedate", "approveddate", "approvalon",
  "completiondate", "completed_on",
  "issueddate", "issued_date", "issued",
  "issuancedate", "issuance_date",
  "date_issued", "date_filed", "date_applied", "date_approved",
  "datepermit", "dt_issued", "dt_permit",
]);
// REJECT: row metadata, even though they contain "date".
const DATE_REJECT_PATTERNS = [
  /^created_?user$/i,
  /^last_?edited_?user$/i,
  /^last_?edited_?date$/i,
  /^created_?date$/i,
  /^created_?at$/i,
  /^updated_?at$/i,
  /^modified_?date$/i,
  /^modified_?at$/i,
  /^load_?date$/i,
  /^ingest_?date$/i,
  /^refresh_?date$/i,
  /^sync_?date$/i,
  /^objectid$/i,
  /^globalid$/i,
  /^fid$/i,
  /^row_?id$/i,
  /^etl_?date$/i,
];
// Priority order when multiple ACCEPT-eligible columns exist.
const DATE_PRIORITY_BUCKETS = [
  // Bucket 1 — "issued" forms beat everything else
  /^(?:permit_?|app_?|appl_?)?issued?(?:_?date|_?dt)?$/i,
  /^date_?issued$/i,
  /^issdate$/i,
  // Bucket 2 — application / applied / filed
  /^(?:permit_?|app_?|appl_?)?(?:applied|application|filed)(?:_?date|_?dt)?$/i,
  /^date_?(?:applied|filed)$/i,
  // Bucket 3 — permit_date
  /^permit_?date$/i,
  // Bucket 4 — effective / completion
  /^(?:effective|complete[d]?|completion|finaled?)(?:_?date|_?dt)?$/i,
];

// ── helpers ────────────────────────────────────────────────────────
function matchesAny(s, patterns) {
  if (!s) return false;
  return patterns.some((p) => p.test(s));
}

function pickByPatterns(keys, patterns) {
  for (const pat of patterns) {
    const hit = keys.find((k) => pat.test(k));
    if (hit) return hit;
  }
  return "";
}

function isAddrTierA(name) { return matchesAny(name, ADDR_TIER_A_PATTERNS); }
function isAddrTierB(name) { return matchesAny(name, ADDR_TIER_B_PATTERNS); }
function isAddrTierC(name) { return matchesAny(name, ADDR_TIER_C_PATTERNS); }

function refineAddr(keys, current) {
  // Strict-first: try Tier A
  const a = pickByPatterns(keys, ADDR_TIER_A_PATTERNS);
  if (a) {
    if (a === current) return { value: a, changed: false, reason: "addr already optimal (Tier A)" };
    // Don't downgrade Tier A → another Tier A unless the current is wrong.
    return {
      value: a,
      changed: true,
      reason: `addr_field: ${current || "(blank)"} → ${a} (preferred situs)`,
    };
  }
  // Tier A miss. Try Tier B.
  const b = pickByPatterns(keys, ADDR_TIER_B_PATTERNS);
  if (b) {
    if (b === current) return { value: b, changed: false, reason: "addr already Tier B (acceptable)" };
    // Current was Tier C? Improvement.
    if (isAddrTierC(current)) {
      return {
        value: b,
        changed: true,
        reason: `addr_field: ${current} → ${b} (replaced ${classifyAddr(current)} with generic Address)`,
      };
    }
    // Current was Tier A? Don't worsen.
    if (isAddrTierA(current)) {
      return { value: current, changed: false, reason: "kept Tier A current; only Tier B available in re-probe" };
    }
    // Current was something we don't recognize / blank — fill with Tier B.
    return {
      value: b,
      changed: true,
      reason: `addr_field: ${current || "(blank)"} → ${b}`,
    };
  }
  // Neither Tier A nor B available. Per safety net, keep the current
  // mapping rather than blanking it — even if it's Tier C.
  if (isAddrTierC(current)) {
    return {
      value: current,
      changed: false,
      reason: `keep ${current} — only Tier C (${classifyAddr(current)}) available; better than blank`,
    };
  }
  return { value: current, changed: false, reason: "no change (no Tier A/B match in keys)" };
}

function classifyAddr(name) {
  if (!name) return "blank";
  if (/owner/i.test(name)) return "owner";
  if (/mail/i.test(name)) return "mailing";
  if (/tax/i.test(name)) return "taxpayer";
  if (/contractor/i.test(name)) return "contractor";
  if (/applicant/i.test(name)) return "applicant";
  if (/billing/i.test(name)) return "billing";
  return "tier-c-other";
}

function isDateAccept(name) {
  if (!name) return false;
  if (matchesAny(name, DATE_REJECT_PATTERNS)) return false;
  if (DATE_ACCEPT_RE.test(name)) return true;
  if (DATE_ACCEPT_EXACT.has(name.toLowerCase())) return true;
  return false;
}

function isDateReject(name) {
  if (!name) return false;
  return matchesAny(name, DATE_REJECT_PATTERNS);
}

function refineDate(keys, current) {
  // Walk priority buckets first.
  let chosen = "";
  for (const pat of DATE_PRIORITY_BUCKETS) {
    chosen = keys.find((k) => pat.test(k) && !isDateReject(k)) || "";
    if (chosen) break;
  }
  // Fallback: any ACCEPT-passing column.
  if (!chosen) {
    chosen = keys.find((k) => isDateAccept(k)) || "";
  }

  if (chosen) {
    if (chosen === current) return { value: chosen, changed: false, reason: "date already optimal" };
    if (isDateReject(current)) {
      return {
        value: chosen,
        changed: true,
        reason: `date_field: ${current} → ${chosen} (was row metadata)`,
      };
    }
    if (isDateAccept(current)) {
      // Both valid — only swap if `chosen` is in a higher bucket than `current`.
      const buckOf = (n) => {
        for (let i = 0; i < DATE_PRIORITY_BUCKETS.length; i++) {
          if (DATE_PRIORITY_BUCKETS[i].test(n)) return i;
        }
        return DATE_PRIORITY_BUCKETS.length;
      };
      if (buckOf(chosen) < buckOf(current)) {
        return {
          value: chosen,
          changed: true,
          reason: `date_field: ${current} → ${chosen} (higher-priority lifecycle date)`,
        };
      }
      return { value: current, changed: false, reason: "kept current accept-list date" };
    }
    // Current is unrecognized; replace with `chosen`.
    return {
      value: chosen,
      changed: true,
      reason: `date_field: ${current || "(blank)"} → ${chosen}`,
    };
  }
  // No accept-eligible candidate. If current is rejected, leave it
  // (per safety net — better than blanking).
  if (isDateReject(current)) {
    return {
      value: current,
      changed: false,
      reason: `keep current ${current} — no lifecycle date column found, refusing to blank`,
    };
  }
  return { value: current, changed: false, reason: "no change (no accept-list date in keys)" };
}

// ── HTTP probe ─────────────────────────────────────────────────────
function isArcGISLike(endpoint, source_type) {
  if (source_type && source_type.toLowerCase() === "arcgis") return true;
  return /\/(FeatureServer|MapServer)(\/\d+)?\/?(\?|$|query)/i.test(endpoint);
}

function buildProbeURL(endpoint, source_type) {
  const arcgis = isArcGISLike(endpoint, source_type);
  if (arcgis) {
    const base = endpoint
      .replace(/\?.*$/, "")
      .replace(/\/query\/?$/i, "")
      .replace(/\/+$/, "");
    return `${base}/query?where=1%3D1&outFields=*&f=json&resultRecordCount=1&returnGeometry=false`;
  }
  const sep = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${sep}$limit=1`;
}

async function probeOne(row) {
  const arcgis = isArcGISLike(row.endpoint, row.source_type);
  const url = buildProbeURL(row.endpoint, row.source_type);
  let status = 0;
  let body = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Henri-FieldMap-RefineV2/1.0" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    status = r.status;
    if (r.ok) {
      const t = await r.text();
      try { body = JSON.parse(t); } catch { body = null; }
    }
  } catch (e) {
    if (e.name === "AbortError") status = 599;
  } finally {
    clearTimeout(timer);
  }

  if (body && body.error) body = null;

  let keys = [];
  let recordCount = 0;
  let sampleRow = null;
  if (body) {
    if (arcgis) {
      const features = Array.isArray(body.features) ? body.features : [];
      recordCount = features.length;
      if (features[0]?.attributes) {
        sampleRow = features[0].attributes;
        keys = Object.keys(sampleRow);
      }
    } else if (Array.isArray(body) && body.length > 0) {
      recordCount = body.length;
      sampleRow = body[0];
      keys = Object.keys(sampleRow);
    }
  }
  return { status, recordCount, keys, sampleRow };
}

// ── DB pull ────────────────────────────────────────────────────────
async function fetchRows() {
  const PAGE = 1000;
  const baseParams = {
    discovered_via: "eq.production_grade_2026-04-29",
    id_field: "not.is.null",
    select:
      "source_key,endpoint,source_type,id_field,type_field,status_field,address_field,date_field,value_field,desc_field,lat_field,lng_field",
    order: "last_count.desc.nullslast",
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
      throw new Error(`fetch failed at offset ${offset}: ${r.status} ${t.slice(0, 300)}`);
    }
    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE) break;
    offset += page.length;
  }
  return all;
}

// ── CSV ────────────────────────────────────────────────────────────
const HEADER =
  "source_key,endpoint,http_status,record_count_estimate,sample_keys," +
  "id_field,type_field,status_field,addr_field,date_field,value_field," +
  "desc_field,lat_field,lng_field,latest_record_date,freshness_days," +
  "recommendation,change_reason";

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
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
      if (k.startsWith('"') && k.endsWith('"')) k = k.slice(1, -1).replace(/""/g, '"');
      seen.add(k);
    }
  }
  return seen;
}

// ── main ───────────────────────────────────────────────────────────
async function main() {
  const rows = await fetchRows();
  console.error(`[refine-v2] fetched ${rows.length} mapped permit_sources rows`);

  const resumeKeys = await loadResumeKeys(OUT_PATH);
  if (resumeKeys.size > 0) {
    console.error(`[refine-v2] resume mode: ${resumeKeys.size} already in ${OUT_PATH}`);
  }

  const append = AUDIT_RESUME && fs.existsSync(OUT_PATH);
  const out = fs.createWriteStream(OUT_PATH, { flags: append ? "a" : "w" });
  if (!append) out.write(HEADER + "\n");

  let n = 0;
  let stopped = false;
  process.on("SIGINT", () => { stopped = true; });
  process.on("SIGTERM", () => { stopped = true; });

  let counts = { UPDATE: 0, KEEP_AS_IS: 0, DEAD: 0 };
  let addrChanged = 0, dateChanged = 0;

  for (const r of rows) {
    if (stopped) break;
    if (n >= AUDIT_LIMIT) break;
    if (resumeKeys.has(r.source_key)) continue;

    const probe = await probeOne(r);

    let recommendation, change_reason, latestDate = "", freshnessDays = "";
    let addrOut = r.address_field || "";
    let dateOut = r.date_field || "";

    const dead =
      probe.status === 0 || probe.status === 599 ||
      probe.status === 404 || probe.status >= 500;

    if (dead) {
      recommendation = "DEAD";
      change_reason = `endpoint now ${probe.status === 599 ? "timeout" : `${probe.status}`}`;
    } else if (probe.keys.length === 0) {
      // 200 with no keys (empty result). Don't change anything.
      recommendation = "KEEP_AS_IS";
      change_reason = "probe returned empty; no schema to refine against";
    } else {
      const addrR = refineAddr(probe.keys, r.address_field || "");
      const dateR = refineDate(probe.keys, r.date_field || "");
      addrOut = addrR.value;
      dateOut = dateR.value;
      const reasons = [];
      if (addrR.changed) { reasons.push(addrR.reason); addrChanged++; }
      if (dateR.changed) { reasons.push(dateR.reason); dateChanged++; }
      if (reasons.length === 0) {
        recommendation = "KEEP_AS_IS";
        change_reason = "no change";
      } else {
        recommendation = "UPDATE";
        change_reason = reasons.join(" | ");
      }
      // Latest record date from current date_field (if usable)
      if (dateOut && probe.sampleRow) {
        const raw = probe.sampleRow[dateOut];
        if (raw != null && raw !== "") {
          const d = typeof raw === "number" ? new Date(raw) : new Date(String(raw));
          if (!isNaN(d.getTime())) {
            latestDate = d.toISOString().slice(0, 10);
            freshnessDays = String(
              Math.floor((Date.now() - d.getTime()) / 86400000),
            );
          }
        }
      }
    }
    counts[recommendation] = (counts[recommendation] || 0) + 1;

    out.write(
      [
        r.source_key, r.endpoint, probe.status, probe.recordCount,
        probe.keys.slice(0, 30).join("|"),
        r.id_field || "", r.type_field || "", r.status_field || "",
        addrOut, dateOut,
        r.value_field || "", r.desc_field || "",
        r.lat_field || "", r.lng_field || "",
        latestDate, freshnessDays,
        recommendation, change_reason,
      ].map(csvEscape).join(",") + "\n",
    );
    n++;
    if (n % 200 === 0) {
      console.error(
        `[refine-v2] ${new Date().toISOString()} checkpoint ${n}/${rows.length}` +
        ` UPDATE=${counts.UPDATE} KEEP=${counts.KEEP_AS_IS} DEAD=${counts.DEAD}`,
      );
    }
    await new Promise((res) => setTimeout(res, 200 + Math.random() * 200));
  }

  if (stopped) {
    out.write(`PARTIAL — STOPPED AT ${n} OF ${rows.length}\n`);
  }
  out.end();
  console.error(
    `[refine-v2] done. probed=${n}/${rows.length} → ${OUT_PATH}\n` +
    `  UPDATE=${counts.UPDATE}  KEEP_AS_IS=${counts.KEEP_AS_IS}  DEAD=${counts.DEAD}\n` +
    `  addr changes=${addrChanged}  date changes=${dateChanged}`,
  );
}

main().catch((e) => {
  console.error("[refine-v2] fatal:", e);
  process.exit(1);
});
