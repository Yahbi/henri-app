/**
 * Mark permit_sources rows that overlap with the Hermes/OpenClaw verified
 * PRODUCTION_GRADE_SUBSET.csv (144 endpoints, all returned FRESH live data
 * on probe 2026-04-29).
 *
 * V1 of this script (commit b53c289) tried direct equality on
 * `endpoint = '<csv_url>'` and matched 0 rows because permit_sources
 * stores the API URL with query params appended (e.g. `?$where=...`)
 * while the CSV stores the base URL.
 *
 * V2 (this file) extracts a stable token from each CSV URL and does
 * `endpoint ILIKE '%{token}%'`:
 *   - Socrata: 4char-4char dataset slug (e.g. `tdg3-whvc`)
 *   - ArcGIS:  the service-name path segment (e.g. `Construction_Permits`)
 *              or org id (e.g. `ePKBjXrBZ2vEEgWd`)
 * Each token is unique enough that LIKE matches reliably.
 *
 * Effects on matched rows:
 *   - discovered_via       = 'production_grade_2026-04-29' (carries Hermes provenance)
 *   - priority             = 0    (highest — top of activate-arcgis-sources rotation)
 *   - field_mapping_status = 'verified' (existing constraint enum; per-batch
 *                            provenance lives in discovered_via)
 *   - enabled              = true (only flipped when currently false)
 *
 * NOTE: Re-running is idempotent.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/ivfxylgoxgrxttknewsf/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  return r.json();
}

const csvPath = "C:/Users/yabis/Desktop/Data Henri 3/Henri_PRODUCTION_GRADE_SUBSET.csv";
const lines = readFileSync(csvPath, "utf8").split("\n").filter(Boolean);
const header = lines[0].split(",");
const URL_COL = header.findIndex((h) => h === "11_endpoint_url");

/**
 * Extract a unique token that we can safely substring-match on
 * inside permit_sources.endpoint. Returns null if the URL isn't
 * a recognised Socrata or ArcGIS pattern (we skip those rows).
 */
function extractToken(url) {
  if (!url || typeof url !== "string") return null;
  // Socrata: /resource/<4char>-<4char>.json
  const socrata = url.match(/\/resource\/([a-z0-9]{4}-[a-z0-9]{4})\.json/i);
  if (socrata) return socrata[1].toLowerCase();
  // ArcGIS Hub service: /services/<NAME>/FeatureServer or /MapServer
  const arcgisSvc = url.match(/\/services\/([^/]+)\/(?:Feature|Map)Server/i);
  if (arcgisSvc) return arcgisSvc[1];
  // ArcGIS hosted: services\d*\.arcgis\.com/(<orgId>)/arcgis/...
  const arcgisOrg = url.match(/services\d*\.arcgis\.com\/([A-Za-z0-9]+)\/arcgis/);
  if (arcgisOrg) return arcgisOrg[1];
  return null;
}

const rows = lines
  .slice(1)
  .map((line) => {
    const cols = line.split(",");
    return { url: cols[URL_COL]?.trim(), token: extractToken(cols[URL_COL]?.trim()) };
  })
  .filter((r) => r.token);

const uniqueTokens = Array.from(new Set(rows.map((r) => r.token)));
console.log(`PRODUCTION_GRADE rows: ${lines.length - 1}, extractable tokens: ${uniqueTokens.length}`);

let totalUpdated = 0;
const chunkSize = 25;
for (let i = 0; i < uniqueTokens.length; i += chunkSize) {
  const chunk = uniqueTokens.slice(i, i + chunkSize);
  // Build OR-of-LIKEs. Tokens are alnum + dash so no escape issue.
  const orClause = chunk.map((t) => `endpoint ILIKE '%${t}%'`).join(" OR ");
  const result = await q(`
    UPDATE permit_sources
    SET discovered_via = 'production_grade_2026-04-29',
        priority = 0,
        field_mapping_status = 'verified',
        updated_at = NOW()
    WHERE (${orClause})
      AND (discovered_via IS DISTINCT FROM 'production_grade_2026-04-29'
           OR priority IS DISTINCT FROM 0
           OR field_mapping_status IS DISTINCT FROM 'verified')
    RETURNING id;
  `);
  const updated = Array.isArray(result) ? result.length : 0;
  totalUpdated += updated;
  console.log(`  chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(uniqueTokens.length / chunkSize)}: updated ${updated}, running total: ${totalUpdated}`);
}

console.log("\nFinal state — rows with production_grade_2026-04-29 status:");
console.log(await q(`
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE enabled) AS enabled,
    COUNT(*) FILTER (WHERE last_count > 0) AS productive
  FROM permit_sources WHERE discovered_via = 'production_grade_2026-04-29';
`));

console.log("\nEnabling any production_grade_2026-04-29 that aren't enabled:");
const enableResult = await q(`
  UPDATE permit_sources
  SET enabled = true, updated_at = NOW()
  WHERE discovered_via = 'production_grade_2026-04-29' AND enabled = false
  RETURNING id;
`);
console.log(`Newly enabled: ${Array.isArray(enableResult) ? enableResult.length : 0}`);

console.log("\nState distribution of newly-marked sources:");
console.log(await q(`
  SELECT state, COUNT(*) AS verified_count
  FROM permit_sources
  WHERE discovered_via = 'production_grade_2026-04-29'
  GROUP BY state ORDER BY verified_count DESC LIMIT 25;
`));
