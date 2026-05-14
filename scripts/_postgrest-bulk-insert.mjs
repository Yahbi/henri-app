/**
 * Bypass Mgmt API entirely — use PostgREST + service-role JWT to do
 * the stage_history backfill. PostgREST has a separate ingress and
 * connection pool from /database/query, so even when Mgmt API is
 * choked, PostgREST can sometimes work.
 *
 * Strategy: pull leads in batches via SELECT through PostgREST, then
 * INSERT into stage_history through PostgREST. Each batch fits in
 * its own HTTP request budget.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(p, opts = {}) {
  try {
    const r = await fetch(`${URL}/rest/v1/${p}`, {
      ...opts,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        ...opts.headers,
      },
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    return { status: r.status, body: text };
  } catch (e) {
    return { abort: e.message };
  }
}

console.log("=== ping PostgREST ===");
const ping = await rest("leads?select=id&limit=1");
console.log("status:", ping.status, "body:", ping.body?.slice(0, 200));

if (ping.status !== 200) {
  console.error("PostgREST not healthy. Aborting.");
  process.exit(1);
}

const BATCH = 500;
let cursor = null;
let totalInserted = 0;
let chunkN = 0;

while (true) {
  chunkN += 1;
  const cursorFilter = cursor ? `&id=gt.${cursor}` : "";
  const t0 = Date.now();

  // Pull stamped leads in this batch
  const sel = await rest(
    `leads?select=id,opportunity_stage,updated_at,created_at&opportunity_stage=not.is.null${cursorFilter}&order=id.asc&limit=${BATCH}`,
  );
  if (sel.status !== 200) {
    console.error(`[batch ${chunkN}] SELECT failed: ${sel.status} ${sel.body?.slice(0, 200)}`);
    break;
  }
  let rows;
  try { rows = JSON.parse(sel.body); } catch { console.error("non-json"); break; }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`[batch ${chunkN}] no more rows — done`);
    break;
  }

  // Build the INSERT payload
  const payload = rows.map((r) => ({
    lead_id: r.id,
    from_stage: null,
    to_stage: r.opportunity_stage,
    changed_at: r.updated_at ?? r.created_at ?? new Date().toISOString(),
    changed_by_kind: "backfill",
  }));

  // INSERT with on-conflict-do-nothing equivalent — use Prefer: resolution=ignore-duplicates
  const ins = await rest("stage_history", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (ins.status !== 201 && ins.status !== 200) {
    console.error(`[batch ${chunkN}] INSERT failed: ${ins.status} ${ins.body?.slice(0, 200)}`);
    // Try to advance cursor anyway so we don't loop forever
    cursor = rows[rows.length - 1].id;
    continue;
  }
  const elapsed = Date.now() - t0;
  let insertedCount = 0;
  try {
    const arr = JSON.parse(ins.body);
    insertedCount = Array.isArray(arr) ? arr.length : 0;
  } catch {
    insertedCount = rows.length; // optimistic
  }
  totalInserted += insertedCount;
  cursor = rows[rows.length - 1].id;
  console.log(`[batch ${chunkN}] inserted=${insertedCount} cursor=${cursor.slice(0, 8)} elapsed=${elapsed}ms total=${totalInserted}`);
}

console.log(`\n=== final: ${totalInserted} rows inserted across ${chunkN} batches ===`);
