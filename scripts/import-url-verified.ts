/**
 * Apply upstream URL-verification probe results to existing permit_sources
 * rows. This script does NOT create new rows — it flips `enabled=true`
 * (and sets `field_mapping_status='probed'`, `priority=10` when migration
 * 00052 is applied) on rows whose `endpoint` matches a verified URL.
 *
 * Source: C:/Users/yabis/Desktop/Data Henri 3/url_verification_results.csv
 *   Header: index,url,status
 *   The status column uses values like `live_200`, `live_206`, `404`,
 *   `timeout`, `auth_403`, etc. We treat `live_200` and `live_206` as
 *   probed-live. Anything else is dropped.
 *
 * Strategy:
 *   1. Load the entire CSV into memory, keep only `live_*` URLs.
 *   2. Pull all existing endpoints from permit_sources in pages.
 *   3. Find the intersection.
 *   4. Update in batches via `endpoint = ANY($1)` — safe to re-run.
 *
 * The migration-00052 graceful-degrade pattern is the same as the other
 * importers: if `field_mapping_status` / `priority` columns are missing,
 * fall back to flipping just `enabled=true`.
 *
 * Idempotent — re-running is a no-op for rows already enabled.
 *
 * Usage:
 *   npx tsx scripts/import-url-verified.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const s = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

/* ── CSV parser (verbatim from scripts/import-desktop-catalogs.ts) ── */

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"' && raw[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && raw[i + 1] === "\n") i++;
        row.push(cur);
        if (row.some((v) => v.length > 0)) rows.push(row);
        row = [];
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (row.some((v) => v.length > 0)) rows.push(row);
  }
  return rows;
}

/* ── Main ──────────────────────────────────────────────────────────── */

const LIVE_STATUSES = new Set(["live_200", "live_206"]);

(async () => {
  const filePath =
    "C:/Users/yabis/Desktop/Data Henri 3/url_verification_results.csv";
  if (!fs.existsSync(filePath)) {
    console.error(`file not found: ${filePath}`);
    process.exit(1);
  }
  console.log(`reading ${filePath}...`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const grid = parseCsv(raw);
  console.log(`  parsed ${grid.length.toLocaleString()} rows (incl. header)`);

  if (grid.length < 2) {
    console.error("empty CSV");
    process.exit(1);
  }
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const urlIdx = header.indexOf("url");
  const statusIdx = header.indexOf("status");
  if (urlIdx < 0 || statusIdx < 0) {
    console.error(`unexpected header: ${header.join(",")}`);
    process.exit(1);
  }

  const liveUrls = new Set<string>();
  let nonLive = 0;
  let badUrl = 0;
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const url = (row[urlIdx] ?? "").trim();
    const status = (row[statusIdx] ?? "").trim().toLowerCase();
    if (!url || !url.startsWith("http")) {
      badUrl++;
      continue;
    }
    if (!LIVE_STATUSES.has(status)) {
      nonLive++;
      continue;
    }
    liveUrls.add(url);
  }
  console.log(
    `  live (200/206): ${liveUrls.size.toLocaleString()}, non-live: ${nonLive.toLocaleString()}, badUrl: ${badUrl.toLocaleString()}`,
  );

  // Pre-count.
  const { count: totalBefore } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  const { count: enabledBefore } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `\npermit_sources before: total=${totalBefore?.toLocaleString() ?? "?"}, enabled=${enabledBefore?.toLocaleString() ?? "?"}`,
  );

  // Page through existing rows and find the intersection with the live
  // URL set. We restrict to `enabled=false` rows so re-runs after a
  // partial completion only update the rows that still need flipping —
  // this is what makes the script safe to kill at 5m and resume.
  // Supabase caps each response at 1,000 rows; we paginate by id cursor.
  console.log(
    "\nfetching enabled=false endpoints from permit_sources (resumable scan)...",
  );
  const PAGE = 1000;
  const matchedEndpoints = new Set<string>();
  let scanned = 0;
  let cursor: string | null = null;
  while (true) {
    let q = s
      .from("permit_sources")
      .select("id, endpoint")
      .eq("enabled", false)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) {
      console.error(`  scan failed at cursor ${cursor}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const ep = ((row as { endpoint: string | null }).endpoint ?? "").trim();
      if (ep && liveUrls.has(ep)) matchedEndpoints.add(ep);
    }
    scanned += data.length;
    cursor = (data[data.length - 1] as { id: string }).id;
    if (data.length < PAGE) break;
    if (scanned % 25000 < PAGE) {
      console.log(
        `  scanned ${scanned.toLocaleString()} rows, matched ${matchedEndpoints.size.toLocaleString()}`,
      );
    }
  }
  console.log(
    `  scanned ${scanned.toLocaleString()} total enabled=false rows, matched ${matchedEndpoints.size.toLocaleString()} endpoints`,
  );

  if (matchedEndpoints.size === 0) {
    console.log("nothing to flip");
    return;
  }

  // Update in batches. Use `endpoint = ANY($urls)` via the .in() helper.
  // Smaller batch size keeps the URL-encoded predicate well under the
  // PostgREST / CF proxy limits — 50 long ArcGIS URLs already pushes
  // ~6KB. Bumping past 100 hit Cloudflare 520s on Supabase's edge.
  const endpoints = Array.from(matchedEndpoints);
  const BATCH = 25;
  let ok = 0;
  let err = 0;
  let useLegacy = false;

  async function tryUpdate(chunk: string[], legacy: boolean): Promise<{ ok: boolean; msg: string | null }> {
    const fullPayload = {
      enabled: true,
      field_mapping_status: "probed",
      priority: 10,
    };
    const legacyPayload = { enabled: true };
    // Up to 3 retries with exponential backoff on 5xx / network noise.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = legacy
        ? await s.from("permit_sources").update(legacyPayload).in("endpoint", chunk)
        : await s.from("permit_sources").update(fullPayload).in("endpoint", chunk);
      if (!error) return { ok: true, msg: null };
      const msg = error.message ?? "";
      const isMissingCol =
        error.code === "42703" ||
        error.code === "PGRST204" ||
        /column .* does not exist/i.test(msg) ||
        /could not find the .* column/i.test(msg) ||
        /schema cache/i.test(msg);
      if (isMissingCol) return { ok: false, msg };
      const isTransient =
        /520|521|522|523|524/.test(msg) ||
        /Bad Request/i.test(msg) ||
        /fetch failed/i.test(msg) ||
        /timeout/i.test(msg) ||
        /ECONNRESET/i.test(msg) ||
        /ETIMEDOUT/i.test(msg);
      if (!isTransient) return { ok: false, msg };
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    return { ok: false, msg: "exhausted retries" };
  }

  // Fallback: when a batch keeps 5xx'ing, retry one URL at a time via
  // .eq() — that pushes only one endpoint into the URL-encoded
  // predicate so the URL stays short. Mops up the long-URL stragglers.
  async function tryUpdateOne(url: string, legacy: boolean): Promise<boolean> {
    const fullPayload = {
      enabled: true,
      field_mapping_status: "probed",
      priority: 10,
    };
    const legacyPayload = { enabled: true };
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = legacy
        ? await s.from("permit_sources").update(legacyPayload).eq("endpoint", url)
        : await s.from("permit_sources").update(fullPayload).eq("endpoint", url);
      if (!error) return true;
      const msg = error.message ?? "";
      const isTransient =
        /520|521|522|523|524/.test(msg) ||
        /Bad Request/i.test(msg) ||
        /fetch failed/i.test(msg) ||
        /timeout/i.test(msg);
      if (!isTransient) return false;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    return false;
  }

  for (let i = 0; i < endpoints.length; i += BATCH) {
    const chunk = endpoints.slice(i, i + BATCH);
    const res = await tryUpdate(chunk, useLegacy);
    if (res.ok) {
      ok += chunk.length;
    } else {
      const msg = res.msg ?? "";
      const isMissingCol =
        /column .* does not exist/i.test(msg) ||
        /could not find the .* column/i.test(msg) ||
        /schema cache/i.test(msg) ||
        /PGRST204/.test(msg);
      if (isMissingCol && !useLegacy) {
        useLegacy = true;
        console.log(
          `  [url_verified] migration 00052 columns missing — falling back to enabled=true only`,
        );
        const retry = await tryUpdate(chunk, true);
        if (retry.ok) ok += chunk.length;
        else {
          console.warn(
            `  [url_verified] batch ${i}-${i + BATCH} retry failed: ${(retry.msg ?? "").slice(0, 200)}`,
          );
          err += chunk.length;
        }
      } else {
        // Batch failed for non-missing-column reasons. Try one-at-a-time.
        let perOk = 0;
        for (const url of chunk) {
          if (await tryUpdateOne(url, useLegacy)) perOk++;
        }
        ok += perOk;
        err += chunk.length - perOk;
        if (perOk < chunk.length) {
          console.warn(
            `  [url_verified] batch ${i}-${i + BATCH} fallback: ${perOk}/${chunk.length} via .eq() — ${(msg ?? "").slice(0, 120)}`,
          );
        }
      }
    }
    if ((i / BATCH) % 50 === 0) {
      console.log(
        `  flipped ${ok.toLocaleString()} / ${endpoints.length.toLocaleString()}`,
      );
    }
  }
  console.log(`\n[url_verified] +${ok.toLocaleString()} ok, ${err} errors`);

  const { count: totalAfter } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true });
  const { count: enabledAfter } = await s
    .from("permit_sources")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(
    `\npermit_sources after: total=${totalAfter?.toLocaleString() ?? "?"}, enabled=${enabledAfter?.toLocaleString() ?? "?"}`,
  );
})();
