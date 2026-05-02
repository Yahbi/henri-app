#!/usr/bin/env npx tsx
/* ── Bulk-load discovered ArcGIS permit endpoints into permit_sources ──────
 * One-shot: reads the local discovery CSV produced by the Python loader
 * `discover_arcgis_permits.py` and bulk-inserts each unique endpoint into
 * Henri's `permit_sources` table with `enabled=false` and a clear
 * `discovered_via` tag so we can selectively re-enable in batches.
 *
 * Source: C:/Users/yabis/Desktop/data complete/henri_production/output/_discovered_permit_endpoints.csv
 *
 * Run: pnpm tsx scripts/_bulk-load-permit-sources.ts
 * ──────────────────────────────────────────────────────────────────────── */

import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SRC = "C:/Users/yabis/Desktop/data complete/henri_production/output/_discovered_permit_endpoints.csv";

function slugify(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

interface SourceRow {
  source_key: string;
  name: string;
  state: string | null;
  jurisdiction: string;
  endpoint: string;
  source_type: string;
  enabled: boolean;
  discovered_via: string;
  notes: string;
}

async function main() {
  const text = readFileSync(SRC, "utf8");
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const idx = (k: string) => header.indexOf(k);

  const rows: SourceRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const url = (cells[idx("feature_service_url")] || "").trim();
    if (!url || (!url.includes("FeatureServer") && !url.includes("MapServer"))) continue;
    // permit_sources.state is NOT NULL — default to 'XX' when the
    // discovery CSV didn't capture it. We'll backfill via jurisdiction
    // text matching in a follow-up pass.
    const stateRaw = (cells[idx("state")] || "").trim().toUpperCase();
    const state = stateRaw || "XX";
    const juris = (cells[idx("jurisdiction")] || cells[idx("title")] || "unknown").trim();
    const title = (cells[idx("title")] || "").trim();
    const itemId = (cells[idx("item_id")] || "").trim();
    const org = (cells[idx("org")] || "").trim();
    const key = `arcgis_${slugify(juris)}_${itemId}`.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      source_key: key,
      name: (title ? `${juris} — ${title}` : juris).slice(0, 200),
      state: state.slice(0, 2),
      jurisdiction: juris.slice(0, 100),
      endpoint: url.slice(0, 500),
      source_type: "arcgis",
      enabled: false,
      discovered_via: "arcgis_local_pull_2026-05-01",
      notes: `discovered via discover_arcgis_permits.py; org=${org.slice(0, 80)}`,
    });
  }
  console.log(`Parsed ${rows.length} unique ArcGIS endpoints from discovery CSV.`);

  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error, count } = await supabase
      .from("permit_sources")
      .upsert(slice, { onConflict: "source_key", count: "exact", ignoreDuplicates: true });
    if (error) {
      console.error(`batch ${i}/${rows.length} ERROR: ${error.message}`);
      continue;
    }
    inserted += count ?? 0;
    if ((i / BATCH) % 5 === 0) {
      console.log(`  ${i + slice.length}/${rows.length} · inserted ${inserted}`);
    }
  }
  console.log(`Done. Net inserted: ${inserted} new rows (existing source_keys deduped).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
