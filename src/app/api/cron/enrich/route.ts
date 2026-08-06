import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enrichLead,
  getTelemetry,
  resetTelemetry,
} from "@/lib/enrichment/orchestrator";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";
import {
  getPriorityZipSets,
  leadTier,
  allPriorityZips,
} from "@/lib/enrichment/priority";
import {
  loadQuotaRemaining,
  recordSpend,
  SOURCE_SPECS,
  type QuotaRemaining,
} from "@/lib/enrichment/quota";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Property-enrichment cron. Runs the free county-GIS lookup against leads
 * that are missing owner/year_built/sqft/assessed_value data, writing the
 * results back to the `leads` table.
 *
 * Coverage: see `src/lib/enrichment/county-gis.ts` — 13+ jurisdictions
 * plus an OpenStreetMap fallback. Per-jurisdiction lookups unlock the
 * whole permit inventory in that metro. Outside those jurisdictions the
 * OSM Nominatim fallback still yields year_built / building levels for
 * a fraction of records.
 *
 * Wedge link: enrichment directly feeds wedge #2 ("transparent confidence")
 * by populating the `contact_completeness` signal in the 6-signal scorer,
 * and wedge #3 ("capacity filter") by populating `assessed_value` that
 * the capacity filter's value-band uses.
 *
 * Gated by CRON_SECRET. Schedule in vercel.json: 13:00, 13:15, 14:00, 14:15.
 * Throughput: BATCH_SIZE=1200 @ CONCURRENCY=6 = 100s typical, 240s worst case.
 */

// Throughput notes (2026-04-30 Phase 3.1 retune):
//   Phase 3 settled at BATCH_SIZE=600 @ CONCURRENCY=4 = ~75s typical. Live
//   audit on 2026-04-30 showed only 0.24% of leads enriched (400 / 165k)
//   because the cron was running once a day at 13:00. At 600 leads/cron the
//   165k backlog clears in ~275 days. Bumping to BATCH_SIZE=1200 @
//   CONCURRENCY=6 + 4 daily slots (13:00 / 13:15 / 14:00 / 14:15) brings
//   throughput to 4,800 leads/day, clearing the backlog in ~35 days while
//   staying inside the 300s maxDuration and well under Supabase's 100
//   connection pool.
//
//   Original Phase 3 context (kept for history): Founder had ~138k leads,
//   ~92% still missing owner_name after the last backfill round. At
//   BATCH_SIZE=400 single-worker that was 400 leads / cron * ~5 s/lead =
//   2,000s / cron — hitting the 300s maxDuration wall after ~60 leads.
//   The 4-worker concurrency parallelises across independent county
//   endpoints (each worker picks its own lead, so two workers rarely
//   hit the same jurisdiction simultaneously).
//
//   Math at CONCURRENCY=6, REQ_INTERVAL_MS=500:
//     per-worker: 1 req/500ms = 2 req/s
//     total:      6 workers  = 12 req/s globally
//     1200 leads = 1200 / 12 = 100 s per batch
//   With slow-endpoint variance the worst case is ~240s — still 60s
//   under maxDuration. If we hit the deadline at scale, the deadline
//   guard exits cleanly without dropping work.
//
//   Per-jurisdiction politeness: even when two workers do end up in the
//   same state, the 500ms interval per-worker means at most 2 req/s to
//   any single county server — the same rate as the old single-worker
//   path. No heuristic throttling needed.
//
//   Pool pressure: 6 workers × 1 SELECT-then-UPDATE per lead = at most
//   6 concurrent Supabase connections. Plus the initial SELECT BATCH_SIZE
//   query. Total upper bound ~7 connections — fine against the 100-pool.
const BATCH_SIZE = 1200;
const CONCURRENCY = 6;

// Polite rate limit — county GIS servers are free, don't hammer them.
// This is per-worker; with CONCURRENCY=4 the global rate is 4x.
const REQ_INTERVAL_MS = 500;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const t0 = Date.now();

  // Audit D3 fix (2026-04-27): orchestrator-level per-source counters
  // were being collected (orchestrator.ts:295 getTelemetry()) but never
  // surfaced. Reset at the start of each invocation so the per-cron
  // numbers are isolated, then snapshot at the end and emit them in
  // the structured log + JSON response. This is the only way to answer
  // "is the Hunter.io / FEC / OpenCorporates pass actually contributing
  // hits?" without cracking open every lead's sources object.
  resetTelemetry();

  // Pick leads that are missing key property data.
  //
  // No ORDER BY — the query uses the "self-advancing filter" pattern
  // from `scripts/backfill-contact-from-raw.ts`. Each invocation sees
  // a fresh slice of `year_built IS NULL` rows; as enrichment writes
  // year_built, those rows drop out of the filter on the next run.
  // Postgres can exit the scan as soon as it collects BATCH_SIZE
  // matches — no full sort, no 60 s statement timeout.
  //
  // History: earlier versions used `ORDER BY score DESC` (to enrich
  // hottest leads first), then `ORDER BY created_at DESC` (to enrich
  // newest first). Both sorted ~130k rows on each query because
  // `year_built IS NULL` matched nearly every row, and neither
  // ordering was index-backed alongside the filter. Result: 4/5
  // invocations of a COUNT=5 burst hit the statement timeout on the
  // SELECT. True priority-enrichment (score DESC) would require a
  // composite partial index:
  //   CREATE INDEX leads_enrich_priority
  //     ON leads (score DESC) WHERE year_built IS NULL;
  // Add that in a migration if/when enrichment-priority becomes a
  // real constraint (today it's not — the 133k-row backlog is
  // processable in ~20 bursts regardless of order).
  //
  // 2026-08-06: the nested `permits(...)` join has now been split out,
  // exactly as the line that used to sit here proposed ("if bursts time out
  // again, split into two queries"). They did: 4 of the 18 enrich runs on
  // 2026-08-04..06 failed with `canceling statement due to statement
  // timeout` on this scan. PostgREST resolves an embed inside the SAME
  // statement as the parent select, so one 1,200-row lead scan also carried
  // 1,200 keyed lookups into a 2.4M-row permits table, and the whole thing
  // shared ONE 8s budget. Split, the lead scan and each 200-id permit lookup
  // are separate statements with a separate budget each. See the chunked
  // permit hydration right after the batch is collected.
  //
  // Not filtering on state — OpenStreetMap + (upcoming) Regrid fallback
  // provide nationwide coverage, so even leads outside our specialised
  // jurisdictions can get year_built from one of those. Leads in CT, CA
  // (LA), NYC, DC, NC, Maricopa, King, Miami-Dade, Denver, Harris TX get
  // the richer county-specific endpoints via the COUNTY_LOOKUPS registry.
  //
  // Pull phone / email / owner_last + the joined permit's contractor_name
  // so the optional voter-registration + Hunter.io passes below can decide
  // whether to fire. Both enrichment modules graceful-degrade to null
  // when their gating env vars aren't set.
  //
  // Eligibility filter: narrow to `year_built IS NULL`. This route is
  // specifically the property-data enricher — year_built is the
  // canonical signal for "needs property enrichment" and the table has
  // ~99% null on it, so the self-advancing filter pattern exits early
  // at BATCH_SIZE matches without scanning the whole table.
  //
  // We briefly broadened this filter on 2026-04-24 to
  // `OR owner_name IS NULL OR phone IS NULL OR email IS NULL` so a
  // single cron would catch all gaps. That caused 38/50 timeouts in
  // the subsequent burst because `email IS NULL` matches nearly every
  // row — the `.or()` path in PostgREST didn't plan as efficiently as
  // the single `.is(null)`, and each invocation was doing vastly more
  // work.
  //
  // Owner_name / phone / email gaps are instead filled by:
  //   - scripts/backfill-contact-from-raw.ts (extracts from raw_json)
  //   - scripts/correlate-enrichment.ts (cross-permit / principal lookup)
  //   - Pass 0 below (same-address lookup — runs inline for leads this
  //     cron DOES touch, since the guard `!lead.owner_name` means it
  //     only fires when needed).
  // Territory-scoped drain (WS2): pull leads in CLAIMED / target-metro ZIPs
  // to the front of the batch, then fill the remainder from the general
  // pool (tier 4). Each lead's tier gates which keyed/quota sources may
  // run, and a per-source budget snapshot caps spend. Free in-DB sources
  // run for every lead regardless.
  const sets = await getPriorityZipSets(supabase);
  const quotaRemaining: QuotaRemaining = await loadQuotaRemaining(supabase);
  // `permit_id` is needed to queue the lead for re-scoring after a
  // successful enrichment patch (see the scored_at reset below).
  const SELECT_COLS =
    "id, permit_id, address, city, state, zip, year_built, home_sqft, assessed_value, owner_name, owner_first, owner_last, phone, email, score";

  const priorityZips = allPriorityZips(sets);
  const collected: Array<Record<string, unknown>> = [];
  const seenIds = new Set<string>();
  let error: { message: string } | null = null;

  if (priorityZips.length > 0) {
    // NOTE (2026-08-04): deliberately NO global `.order("score")` here.
    // A global sort forces Postgres onto idx_leads_score (score DESC over the
    // WHOLE table), discarding non-matching rows one by one — 12,603 ms for a
    // 1200-row batch once a dense ZIP was claimed, which blew past PostgREST's
    // 8 s statement_timeout and made the enrich cron fail outright (only ~1.1%
    // of leads had ever been enriched).
    // Without it the planner uses idx_leads_enrich_priority (zip, score DESC)
    // WHERE year_built IS NULL AND address IS NOT NULL — see migration 00114 —
    // which returns rows already score-ordered WITHIN each ZIP and lets LIMIT
    // short-circuit: 496 ms, a 25x speedup. Per-ZIP score ordering is also
    // fairer across claimed territories than a global sort.
    const { data: pri, error: priErr } = await supabase
      .from("leads")
      .select(SELECT_COLS)
      .in("zip", priorityZips)
      .is("year_built", null)
      .not("address", "is", null)
      .limit(BATCH_SIZE);
    if (priErr) error = priErr;
    for (const l of (pri ?? []) as Array<Record<string, unknown>>) {
      if (!seenIds.has(l.id as string)) { seenIds.add(l.id as string); collected.push(l); }
    }
  }

  // Fill the rest of the batch from the general pool (tier 4).
  if (!error && collected.length < BATCH_SIZE) {
    const { data: rest, error: restErr } = await supabase
      .from("leads")
      .select(SELECT_COLS)
      .is("year_built", null)
      .not("address", "is", null)
      .limit(BATCH_SIZE - collected.length);
    if (restErr) error = restErr;
    for (const l of (rest ?? []) as Array<Record<string, unknown>>) {
      if (!seenIds.has(l.id as string)) { seenIds.add(l.id as string); collected.push(l); }
    }
  }

  const leads = collected;

  /* Attach each lead's permit fields with a SECOND set of statements.
   *
   * `permit_id` is the FK to `permits.id`, so every chunk below is a
   * primary-key lookup. Chunked at 200 because PostgREST puts `.in()` values
   * in the QUERY STRING (~8KB ceiling; 200 UUIDs is ~7.6KB) — the same bound
   * territory-backfill and the score cron use.
   *
   * A missing permit yields `null`, which `processOne` already handles: it
   * reads the field through optional chaining and falls back to null for
   * contractor_name / applicant_name / permit_text.
   */
  const PERMIT_IN_CHUNK = 200;
  if (!error && leads.length > 0) {
    const permitIds = [
      ...new Set(
        leads.map((l) => l.permit_id as string | null).filter(Boolean),
      ),
    ] as string[];
    const byId = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < permitIds.length; i += PERMIT_IN_CHUNK) {
      const chunk = permitIds.slice(i, i + PERMIT_IN_CHUNK);
      const { data: rows, error: pErr } = await supabase
        .from("permits")
        .select("id, contractor_name, applicant_name, description")
        .in("id", chunk);
      if (pErr) {
        error = pErr;
        break;
      }
      for (const p of (rows ?? []) as Array<Record<string, unknown>>) {
        byId.set(p.id as string, p);
      }
    }
    if (!error) {
      for (const l of leads) {
        const pid = l.permit_id as string | null;
        l.permits = pid ? (byId.get(pid) ?? null) : null;
      }
    }
  }

  if (error) {
    logger.error("Enrich cron scan error", { error: error.message });
    await logCronRun("enrich", t0, {
      status: "error",
      error: error.message,
      trigger: detectTrigger(request),
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let enriched = 0;
  let missed = 0;

  // Work-stealing queue: all 4 workers pull from a shared index so faster
  // county endpoints (Maricopa is ~200ms) don't idle waiting for slow ones
  // (OSM Nominatim is ~2s). Each worker processes its lead fully before
  // picking the next — keeps the per-lead logic straightforward.
  const queue = (leads ?? []) as Array<Record<string, unknown>>;
  let cursor = 0;
  // Hard deadline per invocation. 280s leaves 20s headroom vs maxDuration=300.
  const deadline = t0 + 280_000;

  async function processOne(lead: Record<string, unknown>): Promise<void> {
    // Normalize the joined-permits field (PostgREST returns it as an
    // array OR object depending on relationship cardinality).
    const permitsField = (lead as { permits?: unknown }).permits;
    const permitRow = Array.isArray(permitsField)
      ? (permitsField[0] as Record<string, unknown> | undefined)
      : (permitsField as Record<string, unknown> | undefined);

    // Delegate to the unified orchestrator. It composes:
    //   1. Same-address sibling permit lookup (in-DB)
    //   2. Local voter file (FL / NC / OH, once ingested)
    //   3. County GIS (22 jurisdictions)
    //   4. Regrid fallback (gated on REGRID_API_KEY)
    //   5. Contractor license board (CSLB for CA, scaffolds for TX/FL)
    //   6. OpenCorporates (gated on OPENCORPORATES_API_KEY)
    //   7. FEC contributor (gated on FEC_API_KEY)
    //   8. Voter-reg vendor scaffold (no-op today)
    //   9. Hunter.io email inference (gated on HUNTER_API_KEY)
    //
    // Each pass graceful-degrades when its credential is missing, so
    // we can safely add any of these to the deployment env and they'll
    // start contributing without further code changes.
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
      // Feed free-text fields to the description miner. The permit's
      // description is the canonical scope-of-work text across all 25
      // Socrata sources. `leads.notes` was removed from the initial
      // SELECT to keep the query fast — the broad `year_built IS NULL`
      // filter + a wider projection started hitting Supabase's 60s
      // statement budget. If we want to mine `leads.notes` later,
      // fetch it lazily in a targeted update pass.
      permit_text: [permitRow?.description as string | null | undefined],
      supabase,
      // Territory-scoped tier + shared quota snapshot (WS2). Free sources
      // always run; keyed/quota sources gate on tier + remaining budget.
      tier: leadTier(lead.zip as string | null, sets),
      quotaRemaining,
    });

    // Build a patch from the orchestrator result. Only write fields
    // whose value changed from what was already on the lead. Don't
    // clobber existing data with null.
    const patch: Record<string, unknown> = {};
    const assign = (key: string, value: unknown) => {
      if (value == null) return;
      if (lead[key] != null && lead[key] === value) return;
      patch[key] = value;
    };
    assign("owner_name", hit.owner_name);
    assign("owner_first", hit.owner_first);
    assign("owner_last", hit.owner_last);
    assign("phone", hit.phone);
    assign("email", hit.email);
    assign("mailing_address", hit.mailing_address);
    assign("year_built", hit.year_built);
    if (hit.home_sqft != null) patch.home_sqft = String(hit.home_sqft);
    if (hit.lot_sqft != null) patch.lot_sqft = String(hit.lot_sqft);
    assign("assessed_value", hit.assessed_value);
    assign("property_value", hit.property_value);
    assign("owner_occupied", hit.owner_occupied);

    // Extended enrichment fields (migration 00044). Gated on
    // WRITE_EXTENDED=1 the same way as provenance — including these
    // in the UPDATE when the columns don't exist would fail the whole
    // patch. Flip the env var on once 00044 lands.
    if (process.env.WRITE_EXTENDED === "1") {
      assign("employer", hit.employer);
      assign("occupation", hit.occupation);
    }

    // Provenance columns (migration 00039). Gated on WRITE_PROVENANCE=1
    // because including them in the UPDATE when the columns don't
    // exist fails the whole patch, dropping the actual contact data
    // we just captured. Pattern matches scripts/backfill-contact-from-raw.ts.
    if (
      process.env.WRITE_PROVENANCE === "1" &&
      hit.primary_source &&
      Object.keys(patch).length > 0
    ) {
      patch.contact_source = hit.primary_source;
      patch.contact_confidence = hit.confidence;
      patch.contact_extracted_at = new Date().toISOString();
    }

    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await supabase
        .from("leads")
        .update(patch)
        .eq("id", lead.id);
      if (!upErr) {
        enriched++;

        /* Re-score trigger (2026-08-04 audit).
         *
         * Enrichment writes owner_name / phone / email / owner_occupied but
         * never touched score, urgency, score_contact or score_signals — and
         * no re-score path existed, since the score cron only selects
         * permits WHERE scored_at IS NULL. The frozen score_signals jsonb
         * kept rendering "No homeowner contact on file" in the drawer's
         * transparency panel while the adjacent homeowner column displayed
         * the phone we had just found: a self-contradiction on one screen,
         * and a wedge-contract #2 violation.
         *
         * It also understated the total by up to 15 of 100 points
         * (phone +5 / email +3 / owner name +5 / owner-occupied +4), which
         * is decisive against the 75 Hot threshold — enriched leads could
         * never surface as Hot, so an enrichment run changed nothing a
         * contractor actually saw prioritized.
         *
         * Clearing scored_at puts the permit back in the score cron's
         * queue. Safe against duplicate leads: that cron upserts on
         * (permit_id, contractor_id), so the re-score updates the existing
         * row. Best-effort — a failure here costs a stale score, never the
         * enrichment itself. */
        if (lead.permit_id) {
          const { error: rescoreErr } = await supabase
            .from("permits")
            .update({ scored_at: null })
            .eq("id", lead.permit_id);
          if (rescoreErr) {
            logger.warn("enrich: could not queue lead for re-score", {
              leadId: lead.id,
              permitId: lead.permit_id,
              error: rescoreErr.message,
            });
          }
        }
      } else {
        missed++;
      }
    } else {
      missed++;
    }

    // Polite pacing against free public endpoints. Per-worker — global
    // rate is CONCURRENCY × (1 / REQ_INTERVAL_MS) = 8 req/s.
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
        // Per-lead failures must not kill the worker — log and move on.
        logger.warn("enrich lead failed", {
          lead_id: lead.id,
          error: e instanceof Error ? e.message : String(e),
        });
        missed++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Audit D3 fix (2026-04-27): collapse per-source counters into a tidy
  // summary so the structured log line answers, in one row, "what did
  // this cron achieve and which sources moved the needle?". Sorted by
  // hit-rate descending so the top contributors are obvious in Vercel
  // logs.
  const telemetry = getTelemetry();
  const perSource = Object.entries(telemetry)
    .map(([source, t]) => ({
      source,
      calls: t.calls,
      hits: t.hits,
      hit_rate: t.calls > 0 ? Number((t.hits / t.calls).toFixed(3)) : 0,
      avg_latency_ms:
        t.calls > 0 ? Math.round(t.totalLatencyMs / t.calls) : 0,
    }))
    .sort((a, b) => b.hit_rate - a.hit_rate);

  const summary = {
    scanned: leads?.length ?? 0,
    processed: Math.min(cursor, leads?.length ?? 0),
    enriched,
    missed,
    concurrency: CONCURRENCY,
    elapsedMs: Date.now() - t0,
    hitDeadline: Date.now() >= deadline,
    sources: perSource,
  };

  // Persist actual keyed-source spend (from telemetry call-counts) so the
  // next run's quota snapshot reflects it (WS2). Best-effort.
  const spentBySource: Record<string, number> = {};
  for (const s of perSource) {
    if (SOURCE_SPECS[s.source]?.budget != null && s.calls > 0) {
      spentBySource[s.source] = s.calls;
    }
  }
  await recordSpend(supabase, spentBySource);

  // Structured log lets us alert on "Hunter.io hit_rate dropped to 0%
  // overnight" or "OpenCorporates calls=0 for 24h => key revoked".
  logger.info("enrich cron complete", summary);

  // Audit-2026-06-10: surface enrich in cron_runs so the operator + the
  // data-health page can see fill-rate progress. `inserted` = rows whose
  // enrichment actually changed a field; the GH drain workflow stops when
  // a batch returns 0 processed (queue empty).
  await logCronRun("enrich", t0, {
    pulled: summary.scanned,
    inserted: enriched,
    summary,
    trigger: detectTrigger(request),
  });

  return NextResponse.json({ success: true, summary });
}
