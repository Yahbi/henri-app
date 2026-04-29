/**
 * One-shot "sync everything relevant" pass over the `C:\Users\yabis\
 * Desktop\Data Henri 3\` dump. Pulls data from the scattered CSVs and
 * lands it in the right Supabase tables, marking each source with its
 * correct status so the bulk-probe + scraper crons don't waste cycles
 * on known-bad URLs.
 *
 * Actions per file:
 *   - accela_portals.csv / etrakit_portals.csv / tyler_portals.csv
 *       → upsert into permit_sources with enabled=false, error_count=99
 *         (platform-unprobeable sentinel — dedicated HTML scrapers TBD)
 *   - agent_findings.csv
 *       → upsert into permit_sources (master-schema rows)
 *   - additional_permit_sources.csv
 *       → upsert into permit_sources (different schema, mapped here)
 *   - url_dead.csv / url_failures.csv
 *       → flip matching permit_sources rows to enabled=false,
 *         error_count=10 (quarantine-threshold sentinel)
 *   - coverage_summary.csv
 *       → log to console for operator visibility (no DB sync needed)
 *
 * Doesn't touch:
 *   - permits.db / permits_scraper_legacy.db (handled separately —
 *     need schema inspection first)
 *   - markdown docs (copied via a separate pass)
 *   - Python sweep scripts (ops tools, stay on desktop)
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DESKTOP = "C:/Users/yabis/Desktop/Data Henri 3";
const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') q = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function slug(v: string): string {
  return (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function readCsv(file: string): string[][] {
  const raw = fs.readFileSync(path.join(DESKTOP, file), "utf-8").replace(/^\uFEFF/, "");
  return raw.split(/\r?\n/).filter((l) => l.length > 0).map(parseCsvLine);
}

async function chunkUpsert<T>(rows: T[], fn: (chunk: T[]) => Promise<void>, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}

async function importVendorPortals(): Promise<number> {
  // These 3 CSVs share a header-less schema:
  //   zip, city, county, state, auth_note, platform, url
  const files = ["accela_portals.csv", "etrakit_portals.csv", "tyler_portals.csv"];
  // Dedup by source_key within this batch — some vendor portals share the
  // same jurisdiction and generate identical keys. PostgREST upsert
  // rejects a batch that has the same conflict target twice.
  const byKey = new Map<string, Record<string, unknown>>();
  for (const f of files) {
    if (!fs.existsSync(path.join(DESKTOP, f))) continue;
    const lines = readCsv(f);
    for (const c of lines) {
      if (c.length < 7) continue;
      const [zip, city, county, state, , platform, url] = c;
      if (!url || !state) continue;
      const platformSlug = platform.toLowerCase().trim();
      const name = `${platform} portal — ${city || state}`;
      // Include a URL-derived suffix so two vendor portals in the same
      // jurisdiction (e.g. two Tyler instances) don't collide.
      const urlFrag = slug(url.replace(/^https?:\/\//, "")).slice(0, 30);
      const key = `${platformSlug}:${state.toUpperCase()}:${slug(city)}:${slug(zip)}:${urlFrag}`.slice(0, 200);
      byKey.set(key, {
        source_key: key,
        name: name.slice(0, 300),
        state: state.toUpperCase(),
        city: city || null,
        jurisdiction: county || null,
        endpoint: url,
        source_type: platformSlug,
        auth: "unknown",
        enabled: false,
        error_count: 99, // platform-unprobeable sentinel
      });
    }
  }
  const rows = [...byKey.values()];
  console.log(`  vendor portals to upsert: ${rows.length} (deduped from 304 raw)`);
  let ok = 0;
  await chunkUpsert(rows, async (chunk) => {
    const { error } = await s.from("permit_sources").upsert(chunk, { onConflict: "source_key", ignoreDuplicates: false });
    if (error) console.warn("    batch error:", error.message);
    else ok += chunk.length;
  });
  return ok;
}

async function importAgentFindings(): Promise<number> {
  const file = "agent_findings.csv";
  if (!fs.existsSync(path.join(DESKTOP, file))) return 0;
  const lines = readCsv(file);
  const [header, ...data] = lines;
  const idx = (n: string) => header.indexOf(n);
  const ROWS: Array<Record<string, unknown>> = [];
  for (const c of data) {
    if (c.length < header.length - 1) continue;
    const state = (c[idx("State")] ?? "").toUpperCase();
    const endpoint = c[idx("API_Endpoint")] ?? "";
    if (!state || !endpoint) continue;
    const platform = (c[idx("Source_Platform")] ?? "").toLowerCase();
    const pSlug = platform.includes("arcgis") ? "arcgis"
      : platform.includes("socrata") ? "socrata"
      : platform.includes("ckan") ? "ckan"
      : platform || "unknown";
    const city = c[idx("City")] ?? "";
    const nm = c[idx("Dataset_Name")] ?? "";
    const key = `${pSlug}:${state}:${slug(city)}:${slug(nm)}`.slice(0, 200);
    ROWS.push({
      source_key: key,
      name: (nm || `${pSlug} ${state}`).slice(0, 300),
      state,
      city: city || null,
      jurisdiction: c[idx("County")] || null,
      endpoint,
      source_type: pSlug,
      auth: "none",
      enabled: false,
    });
  }
  console.log(`  agent_findings rows: ${ROWS.length}`);
  let ok = 0;
  await chunkUpsert(ROWS, async (chunk) => {
    const { error } = await s.from("permit_sources").upsert(chunk, { onConflict: "source_key", ignoreDuplicates: false });
    if (error) console.warn("    batch error:", error.message);
    else ok += chunk.length;
  });
  return ok;
}

async function importAdditionalSources(): Promise<number> {
  const file = "additional_permit_sources.csv";
  if (!fs.existsSync(path.join(DESKTOP, file))) return 0;
  const lines = readCsv(file);
  // header: source_type,domain,name,state,city,endpoint_url,notes
  const [header, ...data] = lines;
  const idx = (n: string) => header.indexOf(n);
  const ROWS: Array<Record<string, unknown>> = [];
  for (const c of data) {
    const state = (c[idx("state")] ?? "").toUpperCase();
    const endpoint = c[idx("endpoint_url")] ?? "";
    if (!state || !endpoint) continue;
    const platform = (c[idx("source_type")] ?? "").toLowerCase().trim() || "unknown";
    const city = c[idx("city")] ?? "";
    const nm = c[idx("name")] ?? "";
    const key = `${platform}:${state}:${slug(city)}:${slug(nm)}`.slice(0, 200);
    ROWS.push({
      source_key: key,
      name: (nm || `${platform} ${state}`).slice(0, 300),
      state,
      city: city || null,
      endpoint,
      source_type: platform,
      auth: "none",
      enabled: false,
    });
  }
  console.log(`  additional_permit_sources rows: ${ROWS.length}`);
  let ok = 0;
  await chunkUpsert(ROWS, async (chunk) => {
    const { error } = await s.from("permit_sources").upsert(chunk, { onConflict: "source_key", ignoreDuplicates: false });
    if (error) console.warn("    batch error:", error.message);
    else ok += chunk.length;
  });
  return ok;
}

async function markDeadUrls(): Promise<number> {
  // url_dead.csv header: "url","status"
  // url_failures.csv header: "url","status","note"
  const files = ["url_dead.csv", "url_failures.csv"];
  const urls = new Set<string>();
  for (const f of files) {
    if (!fs.existsSync(path.join(DESKTOP, f))) continue;
    const lines = readCsv(f);
    for (let i = 1; i < lines.length; i++) {
      const u = lines[i][0];
      if (u) urls.add(u);
    }
  }
  if (urls.size === 0) return 0;
  console.log(`  dead/failure URLs to flag: ${urls.size}`);
  // UPDATE in chunks — Supabase .in() caps at ~1000 items per call.
  const arr = [...urls];
  let ok = 0;
  for (let i = 0; i < arr.length; i += 500) {
    const chunk = arr.slice(i, i + 500);
    const { data, error } = await s
      .from("permit_sources")
      .update({ enabled: false, error_count: 10 })
      .in("endpoint", chunk)
      .select("source_key");
    if (error) console.warn("    update error:", error.message);
    else ok += data?.length ?? 0;
  }
  return ok;
}

function logCoverageSummary() {
  const file = "coverage_summary.csv";
  if (!fs.existsSync(path.join(DESKTOP, file))) return;
  const lines = readCsv(file);
  // header: state,total_zips,zips_with_source,pct_covered,top_missing_city
  console.log("\nCoverage summary (per-state, from desktop audit):");
  for (let i = 1; i < Math.min(lines.length, 20); i++) {
    const [st, total, withSrc, pct, miss] = lines[i];
    console.log(`  ${st.padEnd(3)} ${withSrc}/${total} (${pct}%)  top missing: ${miss}`);
  }
  console.log(`  ... ${lines.length - 1} states total`);
}

(async () => {
  console.log("=== 1. Vendor portals (accela/etrakit/tyler) ===");
  const vendor = await importVendorPortals();
  console.log(`  OK: ${vendor} rows written/refreshed (error_count=99, unprobeable)`);

  console.log("\n=== 2. agent_findings.csv ===");
  const findings = await importAgentFindings();
  console.log(`  OK: ${findings} rows`);

  console.log("\n=== 3. additional_permit_sources.csv ===");
  const extra = await importAdditionalSources();
  console.log(`  OK: ${extra} rows`);

  console.log("\n=== 4. Mark dead / failed URLs ===");
  const dead = await markDeadUrls();
  console.log(`  OK: ${dead} permit_sources rows quarantined (enabled=false, error_count=10)`);

  console.log("\n=== 5. Coverage summary ===");
  logCoverageSummary();

  // Final totals
  const { count: total } = await s.from("permit_sources").select("id", { count: "exact", head: true });
  const { count: enabled } = await s.from("permit_sources").select("id", { count: "exact", head: true }).eq("enabled", true);
  console.log(`\nFinal permit_sources:  total=${total?.toLocaleString()}  enabled=${enabled?.toLocaleString()}`);
})();
