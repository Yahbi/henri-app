#!/usr/bin/env node
/**
 * Post-process `henri_field_mappings_2026-05-08.csv` (output of the audit
 * script) to apply richer field-mapping heuristics WITHOUT re-probing.
 *
 * The audit script's first pass used exact (case-insensitive) match
 * against a fixed candidate list. That's tight — it misses
 * `ISSUE_DT`, `IssuedDate2`, `EST_VALUE`, `Site_Address_1`, etc. This
 * script reads `sample_keys` from each UPDATE row and re-applies
 * substring + word-boundary heuristics to fill the gaps.
 *
 * Usage:
 *   node scripts/_refine-field-mappings.mjs henri_field_mappings_2026-05-08.csv \
 *       henri_field_mappings_2026-05-08.refined.csv
 */
import * as fs from "node:fs";
import * as readline from "node:readline";

const IN = process.argv[2] || "henri_field_mappings_2026-05-08.csv";
const OUT = process.argv[3] || IN.replace(/\.csv$/, ".refined.csv");
if (!fs.existsSync(IN)) {
  console.error(`input not found: ${IN}`);
  process.exit(2);
}

// Word-boundary regex builder. /\bfoo\b/i but with permissive separators
// (also matches across PascalCase boundaries via lookahead on uppercase).
function makePattern(words) {
  const w = words
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "[_\\W]?"))
    .join("|");
  return new RegExp(`(^|[_\\W]|(?<=[a-z])(?=[A-Z]))(?:${w})(?=[_\\W]|$|[A-Z])`, "i");
}

const PATTERNS = {
  // ID-like — try the exact-name list first, fall back to "permit number"
  // and "case number" word boundaries.
  id: [
    /^(?:permit_?number|permit_?no|permit_?num|permitnumber|permitnum|case_?number|case_?no|recordid|record_?id|building_?permit|app_?id|application_?id)$/i,
    /^(?:objectid|globalid|fid|id)$/i,
  ],
  // Type-like
  type: [
    /^(?:permit_?type|application_?type|app_?type|aptype|work_?type|work_?class|permit_?class|project_?type|case_?type|record_?type|sub_?type|permit_?sub_?type)$/i,
    /^(?:type|category|categorytype|permit_?category)$/i,
  ],
  // Status-like
  status: [
    /^(?:status|permit_?status|case_?status|application_?status|issuance_?status|status_?current|current_?status|stat|permit_?stat)$/i,
  ],
  // Date-like — match anything ending in date/dt and containing
  // issue/issued/applied/application/finaled.
  date: [
    /^(?:issued?_?date|issued?_?dt|issue_?dt|issuance_?date|date_?issued|issued|issdate|issd|issdate_?dttm)$/i,
    /^(?:applied?_?date|application_?date|applieddate|app_?date|app_?dt)$/i,
    /^(?:finaled?_?date|final_?date|completed?_?date|completion_?date|date_?completed)$/i,
    /^(?:filed_?date|received_?date|submitted_?date|date_?filed|date_?received)$/i,
    // Generic date fallback — any column that's literally just "date"
    // or has "date" surrounded by word boundaries.
    /^(?:date|created_?date|updated_?date|created_?at|updated_?at|effective_?date)$/i,
  ],
  // Address-like
  addr: [
    /^(?:address|address_?1|address1|address_?line_?1|street_?address|site_?address|project_?address|property_?address|full_?address|location_?address|original_?address1?|originaladdress1?|orig_?address|primary_?address)$/i,
    /^(?:location|location_?description|locationdescription|loc_?desc|site_?addr|prop_?addr|street_?addr|addr|addr_?line_?1|address_?text)$/i,
  ],
  // Value-like (currency)
  value: [
    /^(?:estimated_?cost|estimated_?value|estimatedcost|estimated_?project_?cost|estprojectcost|est_?cost|est_?value|valuation|declared_?valuation|declared_?value|total_?value|total_?cost|project_?cost|project_?value|projectvalue|job_?value|construction_?cost|construction_?value)$/i,
    /^(?:permit_?value|permit_?cost|fee|total_?fee|cost|value|amount|approx_?cost|approxcost|building_?value)$/i,
  ],
  // Description-like
  desc: [
    /^(?:description|work_?description|workdescr|work_?descr|project_?description|projectdescription|permit_?description|apdesc|app_?desc|case_?description|scope|scope_?of_?work|details|comments|notes|narrative)$/i,
  ],
  // Latitude
  lat: [
    /^(?:latitude|lat|y_?coord|y|coord_?y|geom_?y|location_?y|point_?y)$/i,
  ],
  // Longitude
  lng: [
    /^(?:longitude|long|lon|lng|x_?coord|x|coord_?x|geom_?x|location_?x|point_?x)$/i,
  ],
};

function pickField(keys, patterns) {
  // For each pattern (in priority order), find the first matching key.
  for (const pat of patterns) {
    const hit = keys.find((k) => pat.test(k));
    if (hit) return hit;
  }
  return "";
}

// CSV parse helpers
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  const rl = readline.createInterface({
    input: fs.createReadStream(IN, "utf8"),
    crlfDelay: Infinity,
  });
  const out = fs.createWriteStream(OUT);
  let header = null;
  let idx = {};
  let rowsIn = 0;
  let rowsRefined = 0;
  let stats = {
    id: { before: 0, after: 0 }, type: { before: 0, after: 0 },
    status: { before: 0, after: 0 }, addr: { before: 0, after: 0 },
    date: { before: 0, after: 0 }, value: { before: 0, after: 0 },
    desc: { before: 0, after: 0 }, lat: { before: 0, after: 0 },
    lng: { before: 0, after: 0 },
  };
  for await (const line of rl) {
    if (!line) { out.write("\n"); continue; }
    const cells = parseCsvLine(line);
    if (header === null) {
      header = cells;
      idx = Object.fromEntries(header.map((h, i) => [h, i]));
      out.write(line + "\n");
      continue;
    }
    rowsIn++;
    if (cells.length < header.length) {
      // Bad row (probably the PARTIAL footer). Pass through.
      out.write(line + "\n");
      continue;
    }
    const rec = cells[idx.recommendation];
    const keysStr = cells[idx.sample_keys] || "";
    if (!keysStr || (rec !== "UPDATE" && rec !== "STALE_>90d")) {
      // Refinement only useful where keys exist and HTTP returned data.
      out.write(cells.map(csvEscape).join(",") + "\n");
      continue;
    }
    const keys = keysStr.split("|").filter(Boolean);
    const buckets = {
      id: idx.id_field, type: idx.type_field, status: idx.status_field,
      addr: idx.addr_field, date: idx.date_field, value: idx.value_field,
      desc: idx.desc_field, lat: idx.lat_field, lng: idx.lng_field,
    };
    let touched = false;
    for (const [bucket, colIdx] of Object.entries(buckets)) {
      const before = cells[colIdx];
      if (before) { stats[bucket].before++; }
      if (!before) {
        const found = pickField(keys, PATTERNS[bucket]);
        if (found) {
          cells[colIdx] = found;
          touched = true;
        }
      }
      if (cells[colIdx]) stats[bucket].after++;
    }
    if (touched) rowsRefined++;
    out.write(cells.map(csvEscape).join(",") + "\n");
  }
  out.end();
  console.error(`[refine] read ${rowsIn} rows, refined ${rowsRefined}`);
  console.error("[refine] mapping coverage:");
  for (const [k, v] of Object.entries(stats)) {
    const lift = v.after - v.before;
    console.error(
      `  ${k.padEnd(8)}  before=${String(v.before).padStart(5)}  after=${String(v.after).padStart(5)}  +${lift}`,
    );
  }
}

main().catch((e) => {
  console.error("[refine] fatal:", e);
  process.exit(1);
});
