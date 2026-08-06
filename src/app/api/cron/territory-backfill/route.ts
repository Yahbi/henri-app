/**
 * GET/POST /api/cron/territory-backfill
 *
 * Re-queues already-scored permits that sit inside a claimed territory but
 * never produced a lead, so the score cron can pick them up on its next pass.
 *
 * ─── The bug this closes ──────────────────────────────────────────────────
 * A permit becomes a lead in exactly one place: the score cron's lead-build
 * loop (api/cron/score/route.ts). That loop is fed by
 *
 *     .from("permits").select(...).is("scored_at", null).limit(1000)
 *
 * so each permit is considered for lead creation EXACTLY ONCE, at the moment
 * it is first scored. Inside the loop, a lead row is only pushed when the
 * permit's ZIP resolves to at least one contractor:
 *
 *     const contractors = zipToContractors.get(zip);
 *     if (contractors && contractors.length > 0) { ...push lead... }
 *
 * There is no `else`. A permit scored while its ZIP was unclaimed is dropped
 * silently and, because `scored_at` is now set, is never reconsidered.
 *
 * The consequence is the worst possible one for a paid product: territory is
 * what a contractor buys, and buying it retroactively delivers nothing. Every
 * permit that already exists in their ZIP was scored before they arrived, so
 * it is permanently invisible to them. Measured on production 2026-08-05,
 * against the largest unclaimed ZIPs by permit volume:
 *
 *     ZIP 28269 (Charlotte NC) — 15,112 permits,      0 leads
 *     ZIP 28216 (Charlotte NC) — 10,248 permits,      0 leads
 *
 * A contractor paying $149/mo for 28269 would have opened an empty dashboard
 * and stayed empty except for permits filed after signup — roughly a handful
 * a day against a backlog of fifteen thousand. Meanwhile the 10 ZIPs that
 * ARE claimed show 16,548 permits and 0 without a lead, which is why this
 * never surfaced in testing: the machinery works perfectly for territory that
 * was already claimed when the permits arrived.
 *
 * ─── Why re-queue rather than insert leads directly ───────────────────────
 * Lead construction is ~200 lines of the score cron — signal breakdown,
 * cross-trade rules, permit history, owner extraction, intent staging. A
 * second implementation here would drift from it immediately and produce
 * leads that differ from organically-scored ones. Clearing `scored_at` reuses
 * the real path, so a backfilled lead is byte-for-byte what the scorer would
 * have produced had the territory been claimed at the time.
 *
 * ─── Why only permits with NO lead at all ─────────────────────────────────
 * The scorer assigns a permit to ONE contractor per pass, round-robin across
 * the contractors holding that ZIP. Re-queuing a permit that already has a
 * lead would hand it to the next contractor in rotation and create a second
 * assignment for the same permit — which is exactly what the wedge contract
 * forbids ("one contractor at a time per permit"). Restricting to permits
 * with zero leads makes this operation additive and safe to repeat.
 *
 * ─── Load ────────────────────────────────────────────────────────────────
 * Bulk DML through the Management API took this database down on 2026-08-04,
 * so every write here is a bounded, chunked PostgREST call: at most
 * MAX_PER_RUN permits per invocation, in UPDATE batches of CHUNK ids, with a
 * wall-clock deadline well inside the 300s function limit. The work is
 * idempotent and resumable — whatever is left is simply picked up next run.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Permits re-queued per invocation. The score cron drains 1,000 per run
 *  every 20 minutes (~72k/day), so a larger number here would only build a
 *  backlog in front of it. */
const MAX_PER_RUN = 5_000;
/** Ids per UPDATE round-trip.
 *
 *  Two independent ceilings, and the smaller one binds. The 8s PostgREST
 *  statement_timeout is the obvious one, but `.in()` values are sent in the
 *  QUERY STRING, so 500 UUIDs would be ~19KB of URL against a ~8KB limit and
 *  would 414 before Postgres ever saw the statement. 200 keeps both safe. */
const CHUNK = 200;
/** Candidate scan page size. */
const SCAN_PAGE = 1_000;
/**
 * UUIDs per PostgREST `.in()` filter.
 *
 * `.in()` values travel in the QUERY STRING, so this is bounded by URL
 * length, not by row count. 200 UUIDs is ~7.6KB of ids — comfortably inside
 * the ~8KB ceiling with room for the rest of the URL. The same limit applies
 * to the UPDATE below, so CHUNK is deliberately smaller still.
 */
const IN_CHUNK = 200;
/** Leave headroom under maxDuration so the summary always gets written. */
const DEADLINE_MS = 260_000;

async function handler(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();
  const pastDeadline = () => Date.now() - startedAt > DEADLINE_MS;

  let requeued = 0;
  let scanned = 0;
  const perZip: Record<string, number> = {};

  try {
    const { data: territories, error: terrErr } = await supabase
      .from("territories")
      .select("zip")
      .eq("status", "active");

    if (terrErr) throw new Error(`territory fetch failed: ${terrErr.message}`);

    const zips = [...new Set((territories ?? []).map((t) => t.zip).filter(Boolean))] as string[];

    if (zips.length === 0) {
      const empty = { ok: true, zips: 0, scanned: 0, requeued: 0, note: "no active territories" };
      await logCronRun("territory-backfill", startedAt, {
        pulled: 0, inserted: 0, summary: empty, trigger: detectTrigger(request),
      });
      return NextResponse.json(empty);
    }

    for (const zip of zips) {
      if (requeued >= MAX_PER_RUN || pastDeadline()) break;

      // Page through this ZIP's scored permits. `offset` advances only past
      // rows we decided to SKIP: re-queued rows drop out of the `scored_at`
      // filter on the next page, so counting them in the offset would step
      // over unexamined rows.
      let offset = 0;
      for (;;) {
        if (requeued >= MAX_PER_RUN || pastDeadline()) break;

        const { data: candidates, error: permErr } = await supabase
          .from("permits")
          .select("id")
          .eq("zip", zip)
          .not("scored_at", "is", null)
          // Deterministic order. `.range()` without an ORDER BY leaves the
          // row order up to the planner, so two pages of the same scan can
          // overlap or skip rows entirely — the paging arithmetic below only
          // means anything against a stable sequence.
          .order("id", { ascending: true })
          .range(offset, offset + SCAN_PAGE - 1);

        if (permErr) {
          logger.warn("territory-backfill.scan_failed", { zip, error: permErr.message });
          break;
        }
        if (!candidates || candidates.length === 0) break;
        scanned += candidates.length;

        const ids = candidates.map((c) => c.id as string);

        // Which of these already have a lead? Those must not be touched —
        // re-queuing them would create a duplicate assignment under the next
        // contractor in the round-robin.
        //
        // Chunked at IN_CHUNK because PostgREST puts `.in()` values in the
        // QUERY STRING. A full SCAN_PAGE of UUIDs is 1,000 x ~38 chars ~= 38KB
        // of URL, far past the ~8KB ceiling, and the failure mode is a 414
        // rather than anything that looks like a data problem. Getting this
        // wrong would be silent in the worst way: `existing` comes back empty,
        // every permit looks like an orphan, and the route re-queues permits
        // that already have leads — manufacturing exactly the duplicate
        // assignments the wedge contract forbids.
        const withLead = new Set<string>();
        let lookupFailed = false;
        for (let i = 0; i < ids.length; i += IN_CHUNK) {
          const idChunk = ids.slice(i, i + IN_CHUNK);
          const { data: existing, error: leadErr } = await supabase
            .from("leads")
            .select("permit_id")
            .in("permit_id", idChunk);

          if (leadErr) {
            logger.warn("territory-backfill.lead_lookup_failed", { zip, error: leadErr.message });
            lookupFailed = true;
            break;
          }
          for (const l of existing ?? []) withLead.add(l.permit_id as string);
        }
        // Never re-queue on a partial lookup — an incomplete `withLead` set
        // reads as "these permits have no leads" and would duplicate them.
        if (lookupFailed) break;
        const orphans = ids.filter((id) => !withLead.has(id));

        if (orphans.length === 0) {
          // Nothing to do on this page — step over it.
          offset += candidates.length;
          if (candidates.length < SCAN_PAGE) break;
          continue;
        }

        const budget = Math.min(orphans.length, MAX_PER_RUN - requeued);
        let requeuedThisPage = 0;
        for (let i = 0; i < budget; i += CHUNK) {
          if (pastDeadline()) break;
          const slice = orphans.slice(i, Math.min(i + CHUNK, budget));
          const { error: updErr } = await supabase
            .from("permits")
            .update({ scored_at: null })
            .in("id", slice);

          if (updErr) {
            logger.warn("territory-backfill.requeue_failed", { zip, error: updErr.message });
            break;
          }
          requeued += slice.length;
          perZip[zip] = (perZip[zip] ?? 0) + slice.length;
          requeuedThisPage += slice.length;
        }

        // Advance past the rows we did NOT re-queue.
        //
        // Re-queued rows drop out of the `scored_at IS NOT NULL` filter, so
        // the next page shifts down by however many actually moved — and it
        // is `requeuedThisPage`, not `budget`, that moved. The two differ
        // whenever the loop exits early (deadline reached, or an UPDATE
        // errored), and using `budget` then skips orphans that were never
        // touched: they sit unexamined until some later run happens to page
        // over them again.
        offset += candidates.length - requeuedThisPage;
        if (candidates.length < SCAN_PAGE) break;
      }
    }

    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      zips: zips.length,
      scanned,
      requeued,
      per_zip: perZip,
      // True when there is more to do; the next run continues from scratch,
      // which is correct because re-queued rows no longer match the filter.
      more: requeued >= MAX_PER_RUN || pastDeadline(),
    };

    logger.info("territory-backfill.done", result);
    await logCronRun("territory-backfill", startedAt, {
      pulled: scanned,
      inserted: requeued,
      summary: result,
      trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("territory-backfill.error", { error: message });
    await logCronRun("territory-backfill", startedAt, {
      status: "error",
      error: message,
      pulled: scanned,
      inserted: requeued,
      trigger: detectTrigger(request),
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
