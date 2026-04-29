/**
 * Phase 1 — Import permit sources catalog from Data Henri 3.
 *
 * Reads:
 *   - US_Permit_APIs_Complete_Master_Final.csv (Socrata, ArcGIS, CKAN, etc.)
 *   - accela_portals.csv / etrakit_portals.csv / tyler_portals.csv (vendor portals)
 *
 * Inserts new rows with `enabled=false` via ON CONFLICT (source_key) DO NOTHING.
 * Existing rows (including the ~15-46 curated enabled ones) are left UNTOUCHED.
 *
 * Run:  npx tsx scripts/import-permit-sources.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DATA_DIR = "C:/Users/yabis/Desktop/Data Henri 3";
const BATCH = 500;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type Row = {
  source_key: string;
  name: string;
  state: string;
  city: string | null;
  jurisdiction: string | null;
  endpoint: string;
  source_type: "socrata" | "arcgis" | "ckan" | "csv";
  enabled: boolean;
};

/** Minimal RFC 4180 CSV parser good enough for our well-formed inputs. */
function parseCsv(content: string, hasHeader: boolean): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (field.length > 0 || row.length > 0) {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        }
        if (c === "\r" && content[i + 1] === "\n") i++;
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return hasHeader ? rows.slice(1) : rows;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Short stable hash for endpoint disambiguation (8 hex chars). */
function endpointHash(url: string): string {
  // Tiny FNV-1a — deterministic, good enough for source_key disambiguation.
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function mapPlatform(p: string): "socrata" | "arcgis" | "ckan" | "csv" {
  const x = p.toLowerCase();
  if (x.startsWith("socrata")) return "socrata";
  if (x.includes("arcgis") || x.includes("esri")) return "arcgis";
  if (x.includes("ckan")) return "ckan";
  return "csv";
}

function loadMaster(): Row[] {
  const file = path.join(DATA_DIR, "US_Permit_APIs_Complete_Master_Final.csv");
  const rows = parseCsv(fs.readFileSync(file, "utf8"), true);
  const out: Row[] = [];
  for (const r of rows) {
    const [state, city, county, platform, name, endpoint, , categories] = r;
    if (!state || !platform || !endpoint) continue;
    const kind = mapPlatform(platform);
    const ep = endpoint.trim();
    const stateSlug = slug(state);
    const citySlug = city ? slug(city) : "statewide";
    const source_key = `${kind}_${stateSlug}_${citySlug}_${endpointHash(ep)}`;
    out.push({
      source_key,
      name: (name || `${state} ${city || ""} ${platform}`.trim()).slice(0, 200),
      state: state.toUpperCase().slice(0, 2),
      city: city || null,
      jurisdiction: [city, county, state].filter(Boolean).join(", ") || null,
      endpoint: ep,
      source_type: kind,
      enabled: false,
    });
  }
  return out;
}

function loadVendor(file: string, vendor: "accela" | "etrakit" | "tyler"): Row[] {
  const rows = parseCsv(
    fs.readFileSync(path.join(DATA_DIR, file), "utf8"),
    false,
  );
  const out: Row[] = [];
  for (const r of rows) {
    // Columns: zip, city, county, state, availability, vendor, portal_url
    const [zip, city, county, state, , , portalUrl] = r;
    if (!portalUrl || !state) continue;
    const source_key = `${vendor}_${slug(zip || "unknown")}_${slug(city || "")}`;
    out.push({
      source_key,
      name: `${vendor} — ${city || zip} ${state}`,
      state: state.toUpperCase().slice(0, 2),
      city: city || null,
      jurisdiction: [city, county, state].filter(Boolean).join(", ") || null,
      endpoint: portalUrl.trim(),
      source_type: "csv",
      enabled: false,
    });
  }
  return out;
}

async function upsertBatch(rows: Row[]): Promise<void> {
  // ignoreDuplicates = true → existing rows untouched (preserves `enabled`).
  const { error } = await supabase
    .from("permit_sources")
    .upsert(rows, { onConflict: "source_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

async function main() {
  const before = await supabase
    .from("permit_sources")
    .select("*", { count: "exact", head: true });
  const beforeEnabled = await supabase
    .from("permit_sources")
    .select("*", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `Before: ${before.count} total, ${beforeEnabled.count} enabled`,
  );

  // Collect all candidates, dedupe by source_key (last-write-wins within this run).
  const byKey = new Map<string, Row>();
  for (const r of loadMaster()) byKey.set(r.source_key, r);
  for (const r of loadVendor("accela_portals.csv", "accela")) byKey.set(r.source_key, r);
  for (const r of loadVendor("etrakit_portals.csv", "etrakit")) byKey.set(r.source_key, r);
  for (const r of loadVendor("tyler_portals.csv", "tyler")) byKey.set(r.source_key, r);

  const all = [...byKey.values()];
  console.log(`Parsed ${all.length} unique source_keys from CSVs`);

  let done = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    try {
      await upsertBatch(chunk);
    } catch (e) {
      console.error(
        `Batch at offset ${i} failed:`,
        e instanceof Error ? e.message : String(e),
      );
      // Try one-by-one for this chunk to skip bad rows
      for (const row of chunk) {
        try {
          await upsertBatch([row]);
        } catch (e2) {
          console.warn(
            `  skip ${row.source_key}:`,
            e2 instanceof Error ? e2.message : String(e2),
          );
        }
      }
    }
    done += chunk.length;
    if (done % 2000 < BATCH) console.log(`  ${done}/${all.length}`);
  }

  const after = await supabase
    .from("permit_sources")
    .select("*", { count: "exact", head: true });
  const afterEnabled = await supabase
    .from("permit_sources")
    .select("*", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `After:  ${after.count} total, ${afterEnabled.count} enabled (enabled count should be unchanged)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
