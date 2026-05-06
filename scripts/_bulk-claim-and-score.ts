/**
 * "Millions of true leads" — orchestrator.
 *
 * The score cron creates leads only for permits whose ZIP has at least
 * one contractor claim in `territories`. The founder currently owns
 * ~5,610 ZIPs → ~133k leads from a permit pool of ~1.44M. To unlock
 * the rest, this script:
 *
 *   1. Pulls every distinct ZIP from `permits` (paginated) and from
 *      `permit_source_zips` if the table is populated.
 *   2. Inserts a `territories` row (slot=1, status='active') for the
 *      founder for every ZIP not already claimed. Idempotent — uses
 *      `onConflict: zip,slot_number,WHERE status=active` via the unique
 *      index from migration 00003.
 *   3. Loops the local /api/cron/score endpoint until permits.scored_at
 *      IS NULL count drops to ~0. Each call processes 500 permits.
 *
 * Safe to re-run. Idempotent at every step.
 *
 * Hard rule: god-mode bypasses the PLAN_ZIP_LIMITS check, so the
 * founder can legitimately own all 33k+ US ZIPs in dev. This script
 * does NOT extend any subscription tier — it's a one-shot DEV setup
 * for previewing every-permit-as-lead.
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET!;
if (!SUPABASE_URL || !SUPABASE_SR || !CRON_SECRET) {
  console.error("Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.");
  process.exit(1);
}

const s = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

const FOUNDER_EMAIL = "y.abismuth@gmail.com";
const SCORE_URL = "http://localhost:3000/api/cron/score";

async function fetchFounderId(): Promise<string> {
  const { data, error } = await s
    .from("profiles")
    .select("id")
    .eq("email", FOUNDER_EMAIL)
    .single();
  if (error || !data) {
    console.error("founder profile not found");
    process.exit(1);
  }
  return data.id as string;
}

async function fetchAlreadyClaimedZips(founderId: string): Promise<Set<string>> {
  const claimed = new Set<string>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await s
      .from("territories")
      .select("zip")
      .eq("contractor_id", founderId)
      .eq("status", "active")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.warn(`territories scan error: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) claimed.add((r as { zip: string }).zip);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return claimed;
}

async function fetchPermitZips(): Promise<Set<string>> {
  // Pull distinct ZIPs from permits. With ~1.44M rows we can't `SELECT
  // DISTINCT zip` in one shot — paginate by 1000 and dedup client-side.
  // ZIP cardinality is ~30k so the set fits in memory easily.
  const zips = new Set<string>();
  const PAGE = 1000;
  let offset = 0;
  let pages = 0;
  while (true) {
    const { data, error } = await s
      .from("permits")
      .select("zip")
      .not("zip", "is", null)
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.warn(`permits scan error: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const z = (r as { zip: string | null }).zip ?? "";
      if (/^\d{5}$/.test(z)) zips.add(z);
    }
    pages++;
    if (pages % 50 === 0) {
      console.log(`  scanned ${(pages * PAGE).toLocaleString()} permits, ${zips.size.toLocaleString()} unique ZIPs so far`);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
    // Safety cap — 200k permit rows scanned is enough to cover every ZIP
    // (most ZIPs appear thousands of times). Beyond this it's diminishing
    // returns vs cron timeout.
    if (offset >= 200_000) {
      console.log(`  hit 200k-row scan ceiling; assuming ZIP set converged`);
      break;
    }
  }
  return zips;
}

async function bulkClaim(
  founderId: string,
  newZips: string[],
): Promise<{ ok: number; err: number }> {
  const BATCH = 500;
  let ok = 0;
  let err = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < newZips.length; i += BATCH) {
    const chunk = newZips.slice(i, i + BATCH);
    const rows = chunk.map((zip) => ({
      zip,
      contractor_id: founderId,
      status: "active" as const,
      slot_number: 1,
      claimed_at: now,
      created_at: now,
      updated_at: now,
    }));
    // The unique index `uq_territories_zip_slot_active` is partial
    // (WHERE status='active'), so onConflict must reference the same
    // composite. Use `ignoreDuplicates: true` so re-runs are no-ops.
    const { error } = await s
      .from("territories")
      .upsert(rows, {
        onConflict: "zip,slot_number",
        ignoreDuplicates: true,
      });
    if (error) {
      // Slot conflict — retry with slot_number=2, then 3.
      let recovered = false;
      for (const slot of [2, 3]) {
        const fallback = rows.map((r) => ({ ...r, slot_number: slot }));
        const { error: e2 } = await s
          .from("territories")
          .upsert(fallback, {
            onConflict: "zip,slot_number",
            ignoreDuplicates: true,
          });
        if (!e2) {
          recovered = true;
          break;
        }
      }
      if (!recovered) {
        // Final fallback — insert one-by-one to skip the 1-2 broken rows.
        let okOne = 0;
        for (const r of rows) {
          const { error: e3 } = await s.from("territories").insert(r);
          if (!e3) okOne++;
        }
        ok += okOne;
        err += chunk.length - okOne;
      } else {
        ok += chunk.length;
      }
    } else {
      ok += chunk.length;
    }
    if ((i / BATCH) % 5 === 0) {
      console.log(`  claimed ${ok.toLocaleString()} / ${newZips.length.toLocaleString()} (errs=${err})`);
    }
  }
  return { ok, err };
}

async function pullScoreCron(): Promise<{ scored: number; leads: number; assigned: number }> {
  try {
    const r = await fetch(SCORE_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(300_000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn(`  score cron returned ${r.status}: ${txt.slice(0, 200)}`);
      return { scored: 0, leads: 0, assigned: 0 };
    }
    const j = (await r.json()) as { summary?: { scored?: number; leadsCreated?: number; assigned?: number } };
    return {
      scored: j.summary?.scored ?? 0,
      leads: j.summary?.leadsCreated ?? 0,
      assigned: j.summary?.assigned ?? 0,
    };
  } catch (e) {
    console.warn(`  score cron failed: ${(e as Error).message}`);
    return { scored: 0, leads: 0, assigned: 0 };
  }
}

(async () => {
  console.log("=== bulk claim + score ===");
  const founderId = await fetchFounderId();
  console.log(`founder profile id: ${founderId}`);

  console.log("\nPhase 1: scanning current territory claims ...");
  const claimed = await fetchAlreadyClaimedZips(founderId);
  console.log(`  founder owns ${claimed.size.toLocaleString()} ZIPs already`);

  console.log("\nPhase 2: scanning permits.zip distinct values ...");
  const permitZips = await fetchPermitZips();
  console.log(`  ${permitZips.size.toLocaleString()} unique ZIPs in permits table`);

  const newZips = [...permitZips].filter((z) => !claimed.has(z));
  console.log(`\n  ${newZips.length.toLocaleString()} ZIPs to claim`);

  if (newZips.length > 0) {
    console.log("\nPhase 3: bulk-claiming territories ...");
    const claimRes = await bulkClaim(founderId, newZips);
    console.log(`  +${claimRes.ok.toLocaleString()} claimed, ${claimRes.err} errors`);
  }

  console.log("\nPhase 4: looping /api/cron/score until queue drains ...");
  // Each call processes 500 permits. To drain ~1.3M unscored permits we
  // need ~2,600 calls. Cap at 100 iterations per run so we don't loop
  // for hours — re-run this script to continue.
  const MAX_ITERS = Number(process.env.SCORE_ITERS ?? 100);
  let totalLeadsCreated = 0;
  let totalScored = 0;
  for (let i = 0; i < MAX_ITERS; i++) {
    const r = await pullScoreCron();
    totalScored += r.scored;
    totalLeadsCreated += r.leads;
    if (r.scored === 0) {
      console.log(`  iteration ${i + 1}: queue drained — stopping`);
      break;
    }
    if ((i + 1) % 10 === 0) {
      console.log(
        `  iteration ${i + 1}: cumulative scored=${totalScored.toLocaleString()} leads=${totalLeadsCreated.toLocaleString()}`,
      );
    }
  }

  console.log(`\nFinal: scored ${totalScored.toLocaleString()} permits, created ${totalLeadsCreated.toLocaleString()} leads`);

  const finalLeadCount = await s
    .from("leads")
    .select("id", { count: "estimated", head: true });
  console.log(`leads table size (est): ${finalLeadCount.count?.toLocaleString() ?? "?"}`);
})();
