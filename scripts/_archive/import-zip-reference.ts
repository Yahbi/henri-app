/**
 * Phase 2 — Import us_zip_raw.csv → zip_reference table (33,103 rows).
 *
 * Run after 00024_zip_reference.sql migration is applied.
 *   npx tsx scripts/import-zip-reference.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const CSV_PATH = "C:/Users/yabis/Desktop/Data Henri 3/us_zip_raw.csv";
const BATCH = 500;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function parseCsv(content: string): string[][] {
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
        } else inQuotes = false;
      } else field += c;
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
      } else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

type ZipRow = {
  zipcode: string;
  city: string | null;
  county: string | null;
  state: string;
  state_fips: string | null;
  state_name: string | null;
};

async function main() {
  console.log("Reading", CSV_PATH);
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(raw);
  const header = rows[0];
  const idx = {
    state_fips: header.indexOf("state_fips"),
    state: header.indexOf("state"),
    state_abbr: header.indexOf("state_abbr"),
    zipcode: header.indexOf("zipcode"),
    county: header.indexOf("county"),
    city: header.indexOf("city"),
  };
  console.log("Header indexes:", idx);

  const byZip = new Map<string, ZipRow>();
  for (const r of rows.slice(1)) {
    const zipRaw = r[idx.zipcode]?.trim() ?? "";
    if (!zipRaw) continue;
    // Normalize to 5-digit zero-padded
    const zip = zipRaw.padStart(5, "0").slice(0, 5);
    const stateAbbr = (r[idx.state_abbr] ?? "").trim().toUpperCase().slice(0, 2);
    if (!stateAbbr) continue;
    byZip.set(zip, {
      zipcode: zip,
      city: r[idx.city] || null,
      county: r[idx.county] || null,
      state: stateAbbr,
      state_fips: r[idx.state_fips] || null,
      state_name: r[idx.state] || null,
    });
  }
  const all = [...byZip.values()];
  console.log(`Parsed ${all.length} unique ZIPs`);

  let done = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    const { error } = await supabase
      .from("zip_reference")
      .upsert(chunk, { onConflict: "zipcode" });
    if (error) {
      console.error(`Batch ${i} failed:`, error.message);
      process.exit(1);
    }
    done += chunk.length;
    if (done % 5000 < BATCH) console.log(`  ${done}/${all.length}`);
  }

  const { count } = await supabase
    .from("zip_reference")
    .select("*", { count: "exact", head: true });
  console.log(`Done. zip_reference rows: ${count}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
