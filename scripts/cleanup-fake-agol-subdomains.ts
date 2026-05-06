/**
 * Delete permit_sources rows whose endpoint is a fake AGOL subdomain.
 *
 * Background: the source harvester that produced our original catalogs
 * prepended US county names to `.maps.arcgis.com` on a hunch — e.g.
 * `https://wilson.maps.arcgis.com`, `https://williamson.maps.arcgis.com`.
 * Of 15 sampled "hub landings", only 1 resolved to a real AGOL
 * organisation (JH Hickman Surveying — not even a permit source). The
 * other 14 subdomains return HTML with a generic "Sign in" portal but
 * have no backing org, no feature services, no permit data. They're
 * zombie catalog rows that clutter queries and confuse the probe queue.
 *
 * Strategy:
 *   1. Select every row where
 *        source_type = 'arcgis'
 *        error_count = 99          (previously flagged unprobeable)
 *        endpoint matches a bare AGOL subdomain (no /rest/services/)
 *   2. For each row, fetch `{endpoint}/sharing/rest/portals/self?f=json`
 *      with a short timeout (8 s).
 *   3. If the response has a non-null `.id`, KEEP the row (it's a real
 *      org; a future hub-discovery pass might still use it). If `.id`
 *      is null or the request fails, DELETE the row.
 *
 * Concurrent, batched, idempotent. Safe to re-run.
 *
 * Run: npx tsx scripts/cleanup-fake-agol-subdomains.ts
 *      DRY_RUN=1 npx tsx scripts/cleanup-fake-agol-subdomains.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = 16;
const TIMEOUT_MS = 8_000;

/** Matches URLs like `https://X.maps.arcgis.com` or `https://X.arcgis.com`
 *  with no `/rest/services/` path — the shape that fails as a probe. */
function isBareAgolSubdomain(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    const host = u.hostname.toLowerCase();
    const isAgolHost =
      host.endsWith(".arcgis.com") ||
      host === "hub.arcgis.com" ||
      host === "opendata.arcgis.com";
    return isAgolHost && !/\/rest\/services\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/** portal/self returns {id, name, ...} for a real AGOL org; null id or
 *  network failure means the subdomain is a zombie. */
async function isRealAgolOrg(endpoint: string): Promise<boolean> {
  const url = endpoint.replace(/\/+$/, "") + "/sharing/rest/portals/self?f=json";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "henri-cleanup/1.0" },
    });
    clearTimeout(t);
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return false;
    const body = (await res.json()) as { id?: string | null };
    return typeof body.id === "string" && body.id.length > 0;
  } catch {
    clearTimeout(t);
    return false;
  }
}

(async () => {
  // Pull all candidate rows (error_count=99 + arcgis + bare-subdomain shape).
  const PAGE = 1000;
  const candidates: Array<{ source_key: string; endpoint: string }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await s
      .from("permit_sources")
      .select("source_key, endpoint")
      .eq("source_type", "arcgis")
      .eq("error_count", 99)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (isBareAgolSubdomain(r.endpoint as string)) {
        candidates.push(r as { source_key: string; endpoint: string });
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`scanned permit_sources; ${candidates.length.toLocaleString()} bare AGOL subdomain candidates`);

  if (candidates.length === 0) {
    console.log("nothing to do");
    return;
  }

  let pos = 0;
  let real = 0;
  let dead = 0;
  let deleted = 0;
  const toDelete: string[] = [];

  async function worker() {
    while (pos < candidates.length) {
      const row = candidates[pos++];
      if (!row) break;
      const alive = await isRealAgolOrg(row.endpoint);
      if (alive) {
        real++;
      } else {
        dead++;
        toDelete.push(row.source_key);
      }
      const processed = real + dead;
      if (processed % 100 === 0) {
        console.log(`  ${processed}/${candidates.length}  real=${real}  dead=${dead}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\nprobe results: real=${real.toLocaleString()} dead=${dead.toLocaleString()}`);

  if (DRY_RUN) {
    console.log("DRY_RUN=1 — no rows deleted. Re-run without the flag to apply.");
    return;
  }

  // Delete in 50-row batches (PostgREST URL-length safe).
  const BATCH = 50;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const chunk = toDelete.slice(i, i + BATCH);
    const { error } = await s
      .from("permit_sources")
      .delete()
      .in("source_key", chunk);
    if (error) {
      console.warn(`  delete batch ${i}-${i + BATCH} failed: ${error.message}`);
    } else {
      deleted += chunk.length;
    }
    if ((i / BATCH) % 10 === 0) {
      console.log(`  deleted ${deleted.toLocaleString()} / ${toDelete.length.toLocaleString()}`);
    }
  }
  console.log(`\nDone. deleted ${deleted.toLocaleString()} zombie AGOL subdomain rows; kept ${real.toLocaleString()} real orgs.`);
})();
