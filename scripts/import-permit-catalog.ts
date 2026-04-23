/**
 * One-shot import of the 78,383-row US permit-API master catalog into
 * the `permit_sources` table.
 *
 * Source CSV: C:\Users\yabis\Desktop\Data Henri 3\US_Permit_APIs_FINAL_v2.csv
 * Columns: State, City, County, Source_Platform, Dataset_Name, API_Endpoint, Format, Permit_Categories, Notes
 *
 * Strategy:
 *   - Generate a stable `source_key` per row: {platform_slug}:{state}:{city_slug}:{name_slug}
 *   - Upsert on source_key so re-runs are idempotent
 *   - Keep `enabled=false` for all imported rows — they haven't been
 *     live-probed yet, and enabling 78k endpoints at once would crush
 *     the scraper cron. An operator enables individual sources after
 *     verifying them via a (future) admin UI.
 *   - Batch inserts of 500 rows — Supabase PostgREST's payload limit.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const CATALOG_PATH =
  process.env.CATALOG_PATH ??
  "C:/Users/yabis/Desktop/Data Henri 3/US_Permit_APIs_FINAL_v2.csv";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** Minimal CSV parser — the catalog is clean, but a few Notes fields
 * contain commas inside double-quoted strings, so we need proper quote
 * handling. No external deps. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') { inQuotes = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

function slug(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizePlatform(p: string): string {
  const low = (p ?? "").toLowerCase().trim();
  if (low.includes("arcgis")) return "arcgis";
  if (low.includes("socrata")) return "socrata";
  if (low.includes("ckan")) return "ckan";
  if (low.includes("accela")) return "accela";
  if (low.includes("etrakit")) return "etrakit";
  if (low.includes("tyler")) return "tyler";
  if (low.includes("csv")) return "csv";
  return low || "unknown";
}

interface Row {
  State: string;
  City: string;
  County: string;
  Source_Platform: string;
  Dataset_Name: string;
  API_Endpoint: string;
  Format: string;
  Permit_Categories: string;
  Notes: string;
}

(async () => {
  const raw = fs.readFileSync(CATALOG_PATH, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);
  const iState = idx("State");
  const iCity = idx("City");
  const iCounty = idx("County");
  const iPlatform = idx("Source_Platform");
  const iName = idx("Dataset_Name");
  const iEndpoint = idx("API_Endpoint");
  const iCategories = idx("Permit_Categories");
  const iNotes = idx("Notes");

  const rows: Row[] = [];
  const seen = new Set<string>();
  let dupes = 0;
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (c.length < header.length - 1) { skipped++; continue; }
    const row: Row = {
      State: (c[iState] ?? "").trim().toUpperCase(),
      City: (c[iCity] ?? "").trim(),
      County: (c[iCounty] ?? "").trim(),
      Source_Platform: (c[iPlatform] ?? "").trim(),
      Dataset_Name: (c[iName] ?? "").trim(),
      API_Endpoint: (c[iEndpoint] ?? "").trim(),
      Format: "",
      Permit_Categories: (c[iCategories] ?? "").trim(),
      Notes: (c[iNotes] ?? "").trim(),
    };
    if (!row.State || !row.API_Endpoint) { skipped++; continue; }

    const platformSlug = normalizePlatform(row.Source_Platform);
    const nameSlug = slug(row.Dataset_Name);
    const citySlug = slug(row.City);
    const key = `${platformSlug}:${row.State}:${citySlug}:${nameSlug}`.slice(0, 200);
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);

    rows.push(Object.assign(row, { key, platformSlug }) as Row & { key: string; platformSlug: string });
  }
  console.log(`parsed ${rows.length} unique rows (${dupes} dupes, ${skipped} skipped of ${lines.length - 1} total)`);

  // Upsert in batches.
  const BATCH = 500;
  let inserted = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => {
      const rr = r as Row & { key: string; platformSlug: string };
      return {
        source_key: rr.key,
        name: rr.Dataset_Name.slice(0, 300) || `${rr.platformSlug} ${rr.State}`,
        state: rr.State,
        city: rr.City || null,
        jurisdiction: rr.County || null,
        endpoint: rr.API_Endpoint,
        source_type: rr.platformSlug,
        auth: "none",
        enabled: false,
        // Leave field-mapping + update_freq null — they vary per dataset
        // and need individual discovery via an admin probe endpoint.
      };
    });
    const { error } = await s.from("permit_sources").upsert(chunk, {
      onConflict: "source_key",
      ignoreDuplicates: false,
    });
    if (error) {
      console.warn(`batch ${i}-${i + BATCH} errored: ${error.message}`);
      errors += chunk.length;
    } else {
      inserted += chunk.length;
    }
    if ((i / BATCH) % 10 === 0) {
      console.log(`  progress: ${inserted.toLocaleString()} / ${rows.length.toLocaleString()}`);
    }
  }
  console.log(`\nDone. upserted ${inserted.toLocaleString()}, errored ${errors.toLocaleString()} of ${rows.length.toLocaleString()}`);

  // Summary per platform
  const byPlat = new Map<string, number>();
  for (const r of rows) {
    const p = (r as Row & { platformSlug: string }).platformSlug;
    byPlat.set(p, (byPlat.get(p) ?? 0) + 1);
  }
  console.log("\nBy platform:");
  for (const [p, n] of [...byPlat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(12)} ${n.toLocaleString()}`);
  }
})();
