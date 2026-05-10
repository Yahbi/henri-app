/**
 * Backfill `opportunity_stage`, `reason_codes`, `trade_tags` on every
 * existing `leads` row using the intent classifier.
 *
 * Module 1 of the 18-module enhancement plan (2026-05-09 plan §9.1).
 *
 * v2 strategy (after PostgREST timeout + upsert NOT-NULL failure on v1):
 *   1. Walk leads in pages of 1000 by id (Management API SQL, longer timeout).
 *   2. For each page, fetch the matching permits in one extra SQL.
 *   3. Run classify() in-memory.
 *   4. UPDATE via Management API SQL `UPDATE leads SET … FROM (VALUES …) AS u(...)
 *      WHERE leads.id = u.id::uuid` — bulk update in a single round-trip per chunk.
 *
 * Idempotent — re-running stamps the same values (classifier is pure).
 *
 * Usage:
 *   npx tsx scripts/_backfill-intent.mjs [--limit=N] [--dry-run] [--start-offset=N]
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!SUPABASE_TOKEN) {
  console.error("[backfill] missing SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(2);
}

const PROJECT_REF = "ivfxylgoxgrxttknewsf";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function sql(query, attempt = 0) {
  // Phase AA — robust against transient HTML responses (502, 504, rate
  // limit landing pages). Three retries with exponential backoff
  // before bubbling. The Management API occasionally returns HTML
  // instead of JSON when overloaded; retrying with a small wait
  // recovers most of the time.
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  // Detect HTML response (ie. error page) before trying JSON.parse.
  if (text.startsWith("<")) {
    if (attempt < 3) {
      const backoffMs = 2000 * Math.pow(2, attempt);
      console.warn(`[backfill] HTML response from Management API (attempt ${attempt + 1}/3); waiting ${backoffMs}ms…`);
      await new Promise((r) => setTimeout(r, backoffMs));
      return sql(query, attempt + 1);
    }
    throw new Error(`Management API returned HTML after 3 retries (status ${r.status})`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Management API returned non-JSON: ${text.slice(0, 200)}`);
  }
}

const ARG_LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity;
const ARG_DRY = process.argv.includes("--dry-run");
const ARG_START = Number(process.argv.find((a) => a.startsWith("--start-offset="))?.split("=")[1]) || 0;
/**
 * Phase AA — `--start-after-id=<uuid>` is a faster + more reliable
 * resume path than `--start-offset=N`. The OFFSET-based seed-cursor
 * SELECT (`SELECT id FROM leads ORDER BY id OFFSET N LIMIT 1`) hits
 * the Management API's hard OFFSET ceiling around 80k and returns an
 * HTML error page — same root cause as the original keyset rewrite.
 * Pass the last logged `cursor=<uuid>` from the previous run to
 * resume from exactly where the last successful chunk ended.
 */
const ARG_AFTER_ID = process.argv.find((a) => a.startsWith("--start-after-id="))?.split("=")[1] || null;

async function loadClassifier() {
  const m = await import("../src/lib/intent/classify.ts");
  return m.classify;
}

// 2026-05-09 (Phase AA) — dropped from 1000 → 250. The Management
// API's 8s statement timeout was canceling every page-fetch + bulk
// UPDATE on the resume run. Smaller pages keep each round-trip well
// under the timeout. Throughput is bounded by API call latency
// (~300ms per page) rather than chunk size — at 250/page we still
// process ~13k leads/min when the API isn't congested.
const PAGE = 250;

/** Quote a JS string as a Postgres literal; null/undefined → NULL. */
function pgStr(v) {
  if (v == null) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Quote a string array as a Postgres text[] literal. */
function pgArr(arr) {
  if (!arr || arr.length === 0) return "ARRAY[]::text[]";
  return `ARRAY[${arr.map(pgStr).join(",")}]::text[]`;
}

async function main() {
  const classify = await loadClassifier();
  console.log(`[backfill] dry-run=${ARG_DRY} · limit=${ARG_LIMIT === Infinity ? "all" : ARG_LIMIT} · start-offset=${ARG_START}`);

  // 1. Total count for progress reporting.
  const totalRes = await sql(`SELECT COUNT(*)::int AS n FROM leads`);
  const total = totalRes[0]?.n ?? 0;
  console.log(`[backfill] total leads in DB: ${total}`);

  // Module 26 (2026-05-09) — precompute per-ZIP aggregates so the
  // classifier can light up:
  //   nearby_adu_activity_90d        → ≥3 ADU permits in same ZIP, last 90d
  //   nearby_remodel_activity_90d    → ≥5 remodel permits in same ZIP, last 180d
  //   neighborhood_upgrade_trend     → YoY permit-volume growth in same ZIP
  //
  // Single SQL pass over `permits` builds the aggregate. ~40k ZIP rows
  // fit comfortably in JS memory (Map keyed by zip).
  // 2026-05-09 — ZIP-aggregate precompute deferred: the FILTER + ILIKE
  // aggregate over 1.4M permits hits Supabase's 8s statement timeout on
  // the Management API every time. Right architectural answer is a
  // weekly-refreshed materialized view (`zip_pre_intent_aggregates`).
  // Until that ships, the 3 ZIP-aggregate reason codes (nearby_adu_*,
  // nearby_remodel_*, neighborhood_upgrade_trend) stay null on every
  // backfill row; the other 47 codes still fire correctly.
  console.log(`[backfill] ZIP-aggregate precompute deferred (needs materialized view)`);
  const zipAggMap = new Map();

  let processed = 0;
  let stamped = 0;
  // 2026-05-09 — keyset pagination. Previous OFFSET-based approach hit
  // a Management API ceiling around offset=80,000 where the API would
  // return 0 rows even though more data existed. Keyset uses
  // `WHERE id > last_id ORDER BY id LIMIT N` which scales linearly via
  // the PK btree and never trips the OFFSET ceiling.
  //
  // ARG_START semantics changed: when the caller passes a numeric
  // `--start-offset`, we pre-fill `lastId` by SELECTing the id at that
  // offset once. Most callers run from scratch and pass nothing.
  let lastId = null;
  if (ARG_AFTER_ID) {
    // Phase AA — preferred resume path. Skips the OFFSET-based seed
    // entirely; just pin the cursor at the supplied uuid.
    lastId = ARG_AFTER_ID;
    console.log(`[backfill] resuming from id > ${lastId} (--start-after-id)`);
  } else if (ARG_START > 0) {
    const seedRes = await sql(`SELECT id FROM leads ORDER BY id OFFSET ${ARG_START} LIMIT 1`);
    if (Array.isArray(seedRes) && seedRes[0]?.id) {
      lastId = seedRes[0].id;
      console.log(`[backfill] resuming from id > ${lastId} (offset ${ARG_START})`);
    }
  }

  while (processed < ARG_LIMIT) {
    const pageSize = Math.min(PAGE, ARG_LIMIT - processed);

    // 2. Pull a page of leads via keyset (id > lastId). Just the columns
    //    the classifier needs — no permits embed (timeout-prone).
    //    Permits fetched separately below.
    const whereClause = lastId ? `WHERE l.id > '${lastId}'` : "";
    const leadRows = await sql(`
      SELECT
        l.id,
        l.permit_id,
        l.is_homeowner_intake,
        l.year_built,
        l.lot_sqft,
        l.home_sqft,
        l.assessed_value,
        l.property_value,
        l.owner_occupied,
        l.mailing_address,
        l.owner_name,
        l.cascade_count,
        l.permit_history,
        l.trade,
        l.permit_value,
        l.permit_type,
        l.permit_description
      FROM leads l
      ${whereClause}
      ORDER BY l.id
      LIMIT ${pageSize}
    `);

    if (!Array.isArray(leadRows) || leadRows.length === 0) {
      console.log(`[backfill] empty page after id > ${lastId} — done`);
      break;
    }

    // 3. Pull joined permits in one batch (only the lifecycle fields we need).
    //    Module 26 — also fetch `zip` so we can look up the per-ZIP aggregate.
    const permitIds = leadRows.map((r) => r.permit_id).filter(Boolean);
    let permitMap = new Map();
    if (permitIds.length > 0) {
      const inList = permitIds.map((id) => `'${id}'`).join(",");
      const permits = await sql(`
        SELECT id, status, description, estimated_value, applied_date,
               issued_date, completed_date, applicant_name, contractor_name,
               permit_type, zip
        FROM permits
        WHERE id IN (${inList})
      `);
      if (Array.isArray(permits)) {
        for (const p of permits) permitMap.set(p.id, p);
      }
    }

    // 4. Classify each lead.
    const updates = leadRows.map((row) => {
      const permit = permitMap.get(row.permit_id) || {};
      const ageDays = permit.issued_date
        ? Math.max(0, Math.floor((Date.now() - new Date(permit.issued_date).getTime()) / 86400000))
        : permit.applied_date
          ? Math.max(0, Math.floor((Date.now() - new Date(permit.applied_date).getTime()) / 86400000))
          : null;
      const sinceCompletion = permit.completed_date
        ? Math.floor((Date.now() - new Date(permit.completed_date).getTime()) / 86400000)
        : null;

      // Module 26 — pull per-ZIP aggregate for the lead's permit ZIP.
      // Lights up nearby_adu_activity_90d / nearby_remodel_activity_90d /
      // neighborhood_upgrade_trend reason codes when applicable.
      const zipAgg = (permit.zip && zipAggMap.get(permit.zip)) || {};

      const out = classify({
        is_homeowner_intake: row.is_homeowner_intake,
        permit_status: permit.status,
        permit_type: permit.permit_type ?? row.permit_type,
        permit_description: permit.description ?? row.permit_description,
        permit_value: permit.estimated_value ?? row.permit_value,
        permit_age_days: ageDays,
        days_since_completion: sinceCompletion,
        contractor_name: permit.contractor_name,
        applicant_name: permit.applicant_name,
        year_built: row.year_built,
        lot_sqft: row.lot_sqft,
        home_sqft: row.home_sqft,
        assessed_value: row.assessed_value,
        property_value: row.property_value,
        owner_occupied: row.owner_occupied,
        mailing_address: row.mailing_address,
        owner_name: row.owner_name,
        cascade_count: row.cascade_count ?? 0,
        permit_history: row.permit_history ?? null,
        // Module 26 — ZIP-aggregate signals.
        zip_adu_permits_90d: zipAgg.adu_90d ?? null,
        zip_remodel_permits_90d: zipAgg.remodel_180d ?? null,
        zip_neighbor_upgrade_trend: zipAgg.upgrade_trend ?? null,
      });

      return {
        id: row.id,
        stage: out.stage,
        codes: out.reason_codes,
        tags: out.trade_tags,
      };
    });

    // 5. Bulk UPDATE via Management API SQL — UPDATE … FROM (VALUES …) is
    //    one round-trip per chunk of 200.
    if (!ARG_DRY) {
      // 2026-05-09 (Phase AA) — dropped from 200 → 50. The bulk
      // UPDATE FROM (VALUES …) plan-cost grew super-linearly with
      // chunk size on this table size + RLS / trigger overhead;
      // 200-row chunks were tripping the 8s statement timeout
      // every chunk. 50-row chunks reliably finish in ~1.5s each.
      const CHUNK = 50;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const chunk = updates.slice(i, i + CHUNK);
        const valuesSql = chunk
          .map((u) => `(${pgStr(u.id)}::uuid, ${pgStr(u.stage)}, ${pgArr(u.codes)}, ${pgArr(u.tags)})`)
          .join(",");
        const updSql = `
          UPDATE leads l
             SET opportunity_stage = u.stage,
                 reason_codes      = u.codes,
                 trade_tags        = u.tags,
                 updated_at        = NOW()
            FROM (VALUES ${valuesSql}) AS u(id, stage, codes, tags)
           WHERE l.id = u.id
        `;
        const result = await sql(updSql);
        if (result?.message && /ERROR/.test(result.message)) {
          console.error(`[backfill] chunk failed at processed=${processed + i} cursor=${lastId}: ${result.message.slice(0, 200)}`);
        } else {
          stamped += chunk.length;
        }
      }
    }

    processed += leadRows.length;
    // Advance the keyset cursor to the last row's id. ORDER BY l.id ASC
    // guarantees the last row is the largest id in the page.
    lastId = leadRows[leadRows.length - 1].id;
    if (processed % 5000 === 0) {
      console.log(`[backfill] processed ${processed}/${total} · stamped ${stamped} · cursor=${lastId}`);
    }

    // Keyset pagination only stops on an empty page (handled above).
    // Mid-stream short pages from the Management API are fine because
    // the cursor advances based on the largest id returned, regardless
    // of page size.
  }

  console.log(`[backfill] DONE — processed ${processed}, stamped ${stamped}`);
}

main().catch((e) => {
  console.error(`[backfill] fatal:`, e);
  process.exit(1);
});
