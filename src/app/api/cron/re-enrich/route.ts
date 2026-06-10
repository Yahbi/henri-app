/**
 * Re-enrichment cron — backfills stale leads when new sources come online.
 *
 * Phase 2.6 (2026-04-26 session). Distinct from `/api/cron/enrich` which
 * runs every 15 minutes and processes inflow leads (`year_built IS NULL`).
 * This cron runs daily at 2 a.m. UTC and processes the long tail:
 *
 *   - Leads enriched before WeatherStack / Numverify / Cloudmersive / Apollo
 *     came online — they have no phone metadata, no weather context, and no
 *     business-side contact data.
 *   - Leads where the inflow cron got year_built but couldn't find owner /
 *     phone / email — re-running with the now-fuller orchestrator may
 *     succeed where the first pass failed.
 *
 * ## Eligibility filter
 *
 *   - last_enriched_at IS NULL OR last_enriched_at < (now() - 30 days)
 *   - AND (phone IS NULL OR email IS NULL OR owner_name IS NULL)
 *
 * 30 days is the dwell time for a permit to lose competitive heat anyway —
 * leads that go that long without contact info are unlikely to convert,
 * but they're still worth one re-pass when our enrichment surface widens.
 *
 * ## Batch size
 *
 * 200 leads per run × CONCURRENCY=4 × ~2s/lead = ~100s total, well within
 * the 300s maxDuration. Smaller than `/api/cron/enrich` (600/run) because
 * this cron also fires Apollo (~5% of contractor permits) which is the
 * slowest source in the stack.
 *
 * ## Cost
 *
 *   - Apollo: gated on contractor-classified permits w/ no email/phone yet
 *     — at 200 leads × ~5% × ~50% (still missing contact) = ~5 calls/run
 *   - Numverify: 100/mo. The 30-day cache means a lead's phone gets one
 *     hit per month max. Batch of 200 × ~50% with phones = ~100/run; the
 *     cache hits absorb most of the budget after the first night.
 *   - Cloudmersive: 800/mo. Same story.
 *   - WeatherStack: 100/mo. Cached 1h per ZIP; in practice the same ~20
 *     unique ZIPs cycle through nightly = ~20/night ≈ 600/mo (over budget,
 *     so the module's cache + 429 handling absorbs the overage).
 *
 * Net: most calls hit the in-memory cache. The cron is mostly DB-bound.
 *
 * Runtime: nodejs (orchestrator imports Node-only modules — `crypto`,
 * `node-fetch`-via-shim, etc.).
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrichLead } from "@/lib/enrichment/orchestrator";
import { classifyApplicant } from "@/lib/permits/applicant-classifier";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";
import { buildEnrichmentPatch } from "./helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 200;
const CONCURRENCY = 4;
const REQ_INTERVAL_MS = 500;
// Leads older than this get a re-pass. 30 days is the wedge-#1 exclusivity
// window (14 days) plus a buffer for late-arriving enrichment hits.
const STALE_THRESHOLD_DAYS = 30;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const t0 = Date.now();

  // Cutoff: 30 days ago in ISO format. The .or() clause matches NULL OR < cutoff.
  const cutoff = new Date(
    Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Eligibility:
  //   - Must be missing one of the contact-data fields the orchestrator
  //     can populate (phone, email, owner_name).
  //   - Must be stale: never enriched (NULL) OR enriched > 30 days ago.
  //
  // The .or() pattern below mirrors the supabase-js syntax for an OR
  // across the two staleness predicates. The `.is.null` predicate is
  // explicit because PostgREST treats `null` differently in `.or()` lists.
  //
  // The contact-completeness clause uses .or() too because we want
  // (last_enriched_at stale) AND (any contact field null). PostgREST's
  // .or() composes with .and() implicit chaining, so the two .or() calls
  // act as separate AND-grouped OR-clauses.
  // Note on the permits subselect: `permits` only has `applicant_name`
  // and `contractor_name`; the homeowner identity (`owner_name`) lives
  // on the `leads` table itself, so we pass `lead.owner_name` to the
  // classifier rather than trying to project an `owner_name` column out
  // of the permits join (it doesn't exist; that was an early bug from
  // copying the classifier signature literally).
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, address, city, state, zip, year_built, home_sqft, assessed_value, owner_name, owner_first, owner_last, phone, email, score, cascade_count, last_enriched_at, permits(contractor_name, applicant_name, description)",
    )
    .or(
      `last_enriched_at.is.null,last_enriched_at.lt.${cutoff}`,
    )
    .or(
      "phone.is.null,email.is.null,owner_name.is.null",
    )
    .not("address", "is", null)
    .limit(BATCH_SIZE);

  if (error) {
    // If the migration hasn't applied yet, last_enriched_at won't exist —
    // PostgREST returns a 400 with "column does not exist". Treat as a
    // graceful no-op: log and return success-with-zero-processed so the
    // cron schedule doesn't alarm.
    if (/column.*last_enriched_at/i.test(error.message)) {
      logger.warn("re-enrich cron: migration 00051 not applied yet", {
        error: error.message,
      });
      return NextResponse.json({
        success: true,
        skipped_migration_pending: true,
        elapsedMs: Date.now() - t0,
      });
    }
    logger.error("Re-enrich cron scan error", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let enriched = 0;
  let missed = 0;
  let apolloFires = 0;

  const queue = (leads ?? []) as Array<Record<string, unknown>>;
  let cursor = 0;
  // Hard deadline. 280s leaves 20s headroom vs maxDuration=300.
  const deadline = t0 + 280_000;

  async function processOne(lead: Record<string, unknown>): Promise<void> {
    const permitsField = (lead as { permits?: unknown }).permits;
    const permitRow = Array.isArray(permitsField)
      ? (permitsField[0] as Record<string, unknown> | undefined)
      : (permitsField as Record<string, unknown> | undefined);

    // Classify the permit applicant so the orchestrator knows whether
    // to gate Apollo on. Defaults to "homeowner" if there's no permit
    // join (in which case Apollo never fires regardless).
    // Use lead.owner_name (the enriched homeowner identity) rather than
    // a non-existent permits.owner_name column. The classifier compares
    // applicant_name against owner to detect contractor-pulled vs
    // homeowner-pulled — feeding the lead's enriched owner is correct.
    const classification = permitRow
      ? classifyApplicant(
          {
            applicant_name: permitRow.applicant_name as string | null,
            contractor_name: permitRow.contractor_name as string | null,
            owner_name: lead.owner_name as string | null,
          },
          { cascade_count: lead.cascade_count as number | null },
        )
      : null;

    if (classification?.type === "contractor") apolloFires++;

    const hit = await enrichLead({
      address: lead.address as string,
      city: lead.city as string | null,
      state: lead.state as string | null,
      zip: lead.zip as string | null,
      owner_name: lead.owner_name as string | null,
      owner_first: lead.owner_first as string | null,
      owner_last: lead.owner_last as string | null,
      phone: lead.phone as string | null,
      email: lead.email as string | null,
      contractor_name: (permitRow?.contractor_name as string | null) ?? null,
      applicant_name: (permitRow?.applicant_name as string | null) ?? null,
      permit_text: [permitRow?.description as string | null | undefined],
      applicant_classification: classification?.type ?? null,
      supabase,
    });

    // Build the patch — only fields whose value CHANGED. Audit B7 fix
    // (2026-04-27): the prior code routed `home_sqft` / `lot_sqft`
    // through a side-channel that bypassed the equality check, so every
    // nightly run touched every previously-enriched row even when the
    // value was identical. The extracted `buildEnrichmentPatch` in
    // `./helpers` enforces the equality check uniformly and tracks
    // real-field changes separately from the always-stamped
    // `last_enriched_at`. Tested in `__tests__/helpers.test.ts`.
    const { patch, realFieldsChanged } = buildEnrichmentPatch(
      lead as Record<string, unknown>,
      hit,
      {
        writeExtended: process.env.WRITE_EXTENDED === "1",
        writeProvenance: process.env.WRITE_PROVENANCE === "1",
      },
    );

    const { error: upErr } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", lead.id);
    if (upErr) {
      // If last_enriched_at column is missing, silently degrade — the rest
      // of the patch is still valuable.
      if (/column.*last_enriched_at/i.test(upErr.message)) {
        delete patch.last_enriched_at;
        if (realFieldsChanged > 0) {
          const { error: retryErr } = await supabase
            .from("leads")
            .update(patch)
            .eq("id", lead.id);
          if (!retryErr) enriched++;
          else missed++;
        } else {
          missed++;
        }
      } else {
        missed++;
      }
    } else if (realFieldsChanged > 0) {
      // Audit B7: count enriched ONLY when real fields changed,
      // NOT just because we stamped last_enriched_at. The prior
      // `Object.keys(patch).length > 1` check was always true.
      enriched++;
    } else {
      missed++;
    }

    await new Promise((r) => setTimeout(r, REQ_INTERVAL_MS));
  }

  async function worker(): Promise<void> {
    while (true) {
      if (Date.now() > deadline) return;
      const i = cursor++;
      if (i >= queue.length) return;
      const lead = queue[i];
      if (!lead) return;
      try {
        await processOne(lead);
      } catch (e) {
        logger.warn("re-enrich lead failed", {
          lead_id: lead.id,
          error: e instanceof Error ? e.message : String(e),
        });
        missed++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const summary = {
    scanned: leads?.length ?? 0,
    processed: Math.min(cursor, leads?.length ?? 0),
    enriched,
    missed,
    apolloFires,
    concurrency: CONCURRENCY,
    elapsedMs: Date.now() - t0,
    hitDeadline: Date.now() >= deadline,
  };

  // Surface re-enrich in cron_runs (2026-06-10). `inserted` = real-field
  // changes; the GH drain workflow halts when a batch returns 0 scanned.
  await logCronRun("re-enrich", t0, {
    pulled: summary.scanned,
    inserted: enriched,
    summary,
    trigger: detectTrigger(request),
  });

  return NextResponse.json({ success: true, summary });
}
