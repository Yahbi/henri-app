import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enrichLead,
  getTelemetry,
  resetTelemetry,
} from "@/lib/enrichment/orchestrator";
import { logger } from "@/lib/logger";

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
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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
  // The nested `permits(...)` join also contributed cost. Keeping it
  // here for now because dropping it would require a second lookup
  // per batch; premature until we measure. If bursts time out again,
  // split into two queries (leads by id, permits by permit_id IN (...)).
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
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, address, city, state, zip, year_built, home_sqft, assessed_value, owner_name, owner_first, owner_last, phone, email, score, permits(contractor_name, applicant_name, description)",
    )
    .is("year_built", null)
    .not("address", "is", null)
    .limit(BATCH_SIZE);

  if (error) {
    logger.error("Enrich cron scan error", { error: error.message });
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
      if (!upErr) enriched++;
      else missed++;
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

  // Structured log lets us alert on "Hunter.io hit_rate dropped to 0%
  // overnight" or "OpenCorporates calls=0 for 24h => key revoked".
  logger.info("enrich cron complete", summary);

  return NextResponse.json({ success: true, summary });
}
