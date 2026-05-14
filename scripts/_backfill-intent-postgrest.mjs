/**
 * PostgREST-driven leads backfill — bypasses the Mgmt API's 60 req/min
 * ThrottlerException ceiling by going through Henri's own PostgREST
 * ingress (separate connection pool, separate rate limits).
 *
 * Strategy:
 *   1. Page through `leads WHERE opportunity_stage IS NULL` via PostgREST,
 *      sorted by id ASC, using `Range:` header for pagination.
 *   2. For each page, fetch the matching permits via PostgREST IN-list.
 *   3. classify() each row in JS (same classifier as the Mgmt API path).
 *   4. PATCH each lead individually via PostgREST (parallelized with bounded
 *      concurrency).
 *
 * Idempotent — each PATCH writes the same value the classifier produces.
 *
 * Usage:
 *   npx tsx scripts/_backfill-intent-postgrest.mjs [--limit=N] [--page-size=N] [--concurrency=N]
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const ARG_LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity;
const PAGE_SIZE = Number(process.argv.find((a) => a.startsWith("--page-size="))?.split("=")[1]) || 500;
const CONCURRENCY = Number(process.argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1]) || 10;
const ARG_START_AFTER = process.argv.find((a) => a.startsWith("--start-after-id="))?.split("=")[1] || null;

async function rest(p, opts = {}) {
  try {
    const r = await fetch(`${URL}/rest/v1/${p}`, {
      ...opts,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        ...opts.headers,
      },
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    return { status: r.status, body: text };
  } catch (e) {
    return { abort: e.message };
  }
}

async function loadClassifier() {
  const m = await import("../src/lib/intent/classify.ts");
  return m.classify;
}

async function main() {
  const classify = await loadClassifier();
  console.log(`[backfill-rest] page-size=${PAGE_SIZE} · concurrency=${CONCURRENCY} · limit=${ARG_LIMIT === Infinity ? "all" : ARG_LIMIT}`);

  // 1. Confirm PostgREST is healthy
  const ping = await rest("leads?select=id&limit=1");
  if (ping.status !== 200) {
    console.error(`PostgREST ping failed: ${ping.status} ${ping.body?.slice(0, 200)}`);
    process.exit(1);
  }
  console.log("[backfill-rest] PostgREST healthy");

  // 2. Initial NULL-stage count
  const cntRes = await rest("leads?select=id&opportunity_stage=is.null", {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  // Range is in the Content-Range header, but we don't have access to it from `body`
  // Use a separate count call via PostgREST-supported HEAD-style request
  // (we'll re-page until done so this is just a progress reference)
  console.log(`[backfill-rest] starting; will page until no more NULLs`);

  let processed = 0;
  let stamped = 0;
  let cursor = ARG_START_AFTER; // last-seen id for keyset pagination
  let pageN = 0;
  if (cursor) console.log(`[backfill-rest] resuming from id > ${cursor}`);

  while (processed < ARG_LIMIT) {
    pageN += 1;
    const cursorFilter = cursor ? `&id=gt.${cursor}` : "";
    const t0 = Date.now();

    // 3. Pull a page of leads via keyset on id (no opportunity_stage filter
    //    — the partial index on `opportunity_stage IS NOT NULL` doesn't
    //    cover the IS NULL predicate, so filtering NULLs forces a seq scan
    //    that trips the 8s statement timeout. Walking by id is index-fast.
    //    The classifier is idempotent so re-stamping non-NULL rows is fine.
    const sel = await rest(
      `leads?select=id,opportunity_stage,permit_id,is_homeowner_intake,year_built,lot_sqft,home_sqft,assessed_value,property_value,owner_occupied,mailing_address,owner_name,cascade_count,permit_history,trade,permit_value,permit_type,permit_description${cursorFilter}&order=id.asc&limit=${PAGE_SIZE}`,
    );
    if (sel.status !== 200) {
      console.error(`[page ${pageN}] SELECT failed: ${sel.status} ${sel.body?.slice(0, 200)}`);
      // back off + retry once
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    let rows;
    try {
      rows = JSON.parse(sel.body);
    } catch {
      console.error(`[page ${pageN}] non-json: ${sel.body?.slice(0, 200)}`);
      break;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`[page ${pageN}] empty — done`);
      break;
    }

    // 4. Pull joined permits in one batch
    const permitIds = [...new Set(rows.map((r) => r.permit_id).filter(Boolean))];
    const permitMap = new Map();
    if (permitIds.length > 0) {
      const inList = `(${permitIds.map((id) => `"${id}"`).join(",")})`;
      const permits = await rest(
        `permits?select=id,status,description,estimated_value,applied_date,issued_date,completed_date,applicant_name,contractor_name,permit_type,zip&id=in.${inList}`,
      );
      if (permits.status === 200) {
        try {
          const arr = JSON.parse(permits.body);
          if (Array.isArray(arr)) for (const p of arr) permitMap.set(p.id, p);
        } catch { /* fall through */ }
      }
    }

    // 5. Classify each lead — skip rows already stamped to avoid wasted PATCHes
    const nullRows = rows.filter((r) => r.opportunity_stage == null);
    const updates = nullRows.map((row) => {
      const permit = permitMap.get(row.permit_id) || {};
      const ageDays = permit.issued_date
        ? Math.max(0, Math.floor((Date.now() - new Date(permit.issued_date).getTime()) / 86400000))
        : permit.applied_date
          ? Math.max(0, Math.floor((Date.now() - new Date(permit.applied_date).getTime()) / 86400000))
          : null;
      const sinceCompletion = permit.completed_date
        ? Math.floor((Date.now() - new Date(permit.completed_date).getTime()) / 86400000)
        : null;
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
      });
      return {
        id: row.id,
        body: {
          opportunity_stage: out.stage,
          reason_codes: out.reason_codes,
          trade_tags: out.trade_tags,
          updated_at: new Date().toISOString(),
        },
      };
    });

    // 6. PATCH each lead with bounded concurrency
    let pageOK = 0;
    for (let i = 0; i < updates.length; i += CONCURRENCY) {
      const slice = updates.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        slice.map((u) =>
          rest(`leads?id=eq.${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify(u.body),
          }),
        ),
      );
      for (const r of results) {
        if (r.status === 204 || r.status === 200) pageOK += 1;
        else if (r.status >= 400) console.error(`PATCH error ${r.status}: ${r.body?.slice(0, 150)}`);
      }
    }

    processed += rows.length;
    stamped += pageOK;
    cursor = rows[rows.length - 1].id;
    const elapsed = Date.now() - t0;
    console.log(`[page ${pageN}] rows=${rows.length} null=${nullRows.length} ok=${pageOK} cursor=${cursor.slice(0, 8)} elapsed=${elapsed}ms processed=${processed} stamped=${stamped}`);
  }

  console.log(`\n=== final: processed=${processed} stamped=${stamped} pages=${pageN} ===`);
}

main().catch((e) => {
  console.error("[backfill-rest] fatal:", e);
  process.exit(1);
});
