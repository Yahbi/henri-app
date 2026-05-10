/**
 * Validate the Hermes refinement CSV before applying.
 *
 * Hermes occasionally hallucinates field names that aren't in the actual
 * response sample_keys (e.g. recommends `PhysicalAddress` for Montgomery
 * AL when the response only has `OwnerAddress`). Applying those would
 * break currently-functional ArcGIS queries.
 *
 * This script reads the refinement CSV and:
 *   1. For each UPDATE row, checks that every recommended field
 *      (id/type/status/addr/date/value/desc/lat/lng) actually exists
 *      in the sample_keys cell.
 *   2. If a recommendation field is NOT in sample_keys → blank that cell.
 *   3. If a row's recommendations are ALL blanked → downgrade to KEEP_AS_IS.
 *   4. Emit a corrected CSV with `_VALIDATED` suffix.
 *
 * Usage:
 *   node scripts/_validate-refinement-csv.mjs <input.csv> [output.csv]
 */
import * as fs from "node:fs";

const IN  = process.argv[2];
const OUT = process.argv[3] ?? IN.replace(/\.csv$/, "_VALIDATED.csv");
if (!IN || !fs.existsSync(IN)) {
  console.error("Usage: node scripts/_validate-refinement-csv.mjs <input.csv> [output.csv]");
  process.exit(2);
}

function parseCsvLine(line) {
  const cells = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

const text = fs.readFileSync(IN, "utf-8");
const lines = text.split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines[0]);
const idx = (h) => header.indexOf(h);
const KEY_FIELDS = ["id_field", "type_field", "status_field", "addr_field",
                    "date_field", "value_field", "desc_field", "lat_field", "lng_field"];

const stats = {
  total: 0,
  update_in: 0,
  update_out: 0,
  downgraded_to_keep: 0,
  fields_dropped: 0,
  field_drops_by_kind: {},
};

const outRows = [lines[0]];
for (let i = 1; i < lines.length; i++) {
  const raw = lines[i];
  const cells = parseCsvLine(raw);
  if (cells.length !== header.length) { outRows.push(raw); continue; }

  const recommendation = cells[idx("recommendation")];
  if (recommendation !== "UPDATE") { outRows.push(raw); stats.total++; continue; }

  stats.total++;
  stats.update_in++;

  // sample_keys is pipe-delimited per the audit script convention
  const sampleKeys = (cells[idx("sample_keys")] ?? "").split("|").map((k) => k.trim()).filter(Boolean);
  const sampleKeysLower = new Set(sampleKeys.map((k) => k.toLowerCase()));

  let anyKept = false;
  for (const f of KEY_FIELDS) {
    const j = idx(f);
    const v = (cells[j] ?? "").trim();
    if (!v) continue;
    // Allow geometry.x / geometry.y as a special pseudo-key (ArcGIS).
    if (v === "geometry.x" || v === "geometry.y") { anyKept = true; continue; }
    // Allow legitimate compound keys ending with the column name.
    const matches = sampleKeys.includes(v) || sampleKeysLower.has(v.toLowerCase());
    if (matches) {
      anyKept = true;
    } else {
      stats.fields_dropped++;
      stats.field_drops_by_kind[f] = (stats.field_drops_by_kind[f] ?? 0) + 1;
      cells[j] = "";  // blank the hallucinated field
    }
  }

  if (!anyKept) {
    cells[idx("recommendation")] = "KEEP_AS_IS";
    const reasonIdx = idx("change_reason");
    if (reasonIdx >= 0) {
      cells[reasonIdx] = "downgraded by validator: all proposed fields hallucinated";
    }
    stats.downgraded_to_keep++;
  } else {
    stats.update_out++;
  }

  outRows.push(cells.map((c) => c.includes(",") ? `"${c.replace(/"/g, '""')}"` : c).join(","));
}

fs.writeFileSync(OUT, outRows.join("\n") + "\n", "utf-8");
console.log(`[validate] wrote ${OUT}`);
console.log(`[validate] total CSV rows: ${stats.total}`);
console.log(`[validate] UPDATE rows IN: ${stats.update_in}`);
console.log(`[validate] UPDATE rows OUT: ${stats.update_out}`);
console.log(`[validate] downgraded to KEEP_AS_IS: ${stats.downgraded_to_keep}`);
console.log(`[validate] hallucinated field cells blanked: ${stats.fields_dropped}`);
console.log(`[validate] drops by field:`);
for (const [f, n] of Object.entries(stats.field_drops_by_kind).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f}: ${n}`);
}
