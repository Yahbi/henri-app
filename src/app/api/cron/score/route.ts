import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateScore, buildSignals } from "@/lib/scoring";
import type {
  Urgency,
  TradeWeightRow,
  StageModifierRow,
  ScoreCalibration,
} from "@/lib/scoring";
import { buildScoreSignalBreakdown } from "@/lib/scoring/signals";
import { classify as classifyIntent } from "@/lib/intent/classify";
import type { OpportunityStage } from "@/lib/intent/reason-codes";
import { logger } from "@/lib/logger";
import { haversineMi } from "@/lib/geo/haversine";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";
import { evaluateRules, type AddressPermitHistory } from "@/lib/predictive/rules";
import { mineDescription, mergeSuggestions } from "@/lib/predictive/llm-mining";
import { getMiningLlmClient } from "@/lib/predictive/openai-client";
import {
  buildValueModel,
  forecastValue,
  type ValueModel,
} from "@/lib/predictive/value-forecast";
import type { Lead } from "@/types/lead";
import { extractOwnerFields, normalizeAddrKey } from "./helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

/* ── Types for query results ─────────────────────────────────────────────── */

interface PermitRow {
  id: string;
  permit_type: string | null;
  status: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  estimated_value: number | null;
  issued_date: string | null;
  applied_date: string | null;
  applicant_name: string | null;
  created_at: string;
  raw_json: Record<string, unknown> | null;
}

interface ScoredLead {
  permit: PermitRow;
  score: number;
  urgency: Urgency;
  reasoning: string;
  freshness: number;
  value: number;
  contact: number;
  demand: number;
  engagement: number;
  conversion: number;
  factors: string[];
  /** Phase 0a: typed signal breakdown for the transparency drawer.
   *  Written to `leads.score_signals` jsonb when migration 00031 is
   *  applied; silently dropped otherwise via the try/catch around the
   *  upsert. */
  score_signals: unknown;
  /** Module 1 — opportunity_stage stamped at score time. Drives
   *  per-stage modifier lookup (Module 13) and the stage chip in
   *  the lead-card UI. May be null when the classifier can't
   *  decide. Written to `leads.opportunity_stage` (migration 00087). */
  opportunity_stage: OpportunityStage | null;
  /** Module 1 — reason_codes from the classifier. Top 3 surface in
   *  the drawer chip tooltip. Written to `leads.reason_codes`. */
  reason_codes: string[];
}

/* ── Conversion rate helpers ─────────────────────────────────────────────── */

async function fetchConversionRates(
  supabase: ReturnType<typeof createAdminClient>,
  zips: string[],
  _trades: string[]
): Promise<{
  zipRates: Map<string, number>;
  tradeRates: Map<string, number>;
}> {
  const zipRates = new Map<string, number>();
  const tradeRates = new Map<string, number>();

  if (zips.length === 0) return { zipRates, tradeRates };

  /* Fetch all leads with a definitive outcome to compute win rates */
  const { data: historicalLeads } = await supabase
    .from("leads")
    .select("zip, trade, status")
    .in("status", ["won", "lost", "archived"])
    .in("zip", zips);

  if (!historicalLeads || historicalLeads.length === 0) {
    return { zipRates, tradeRates };
  }

  /* Group by ZIP */
  const zipCounts = new Map<string, { won: number; total: number }>();
  for (const lead of historicalLeads) {
    if (!lead.zip) continue;
    const entry = zipCounts.get(lead.zip) ?? { won: 0, total: 0 };
    entry.total++;
    if (lead.status === "won") entry.won++;
    zipCounts.set(lead.zip, entry);
  }

  for (const [zip, counts] of zipCounts) {
    if (counts.total >= 3) {
      /* Only compute rate with minimum sample size */
      zipRates.set(zip, counts.won / counts.total);
    }
  }

  /* Group by trade */
  const tradeCounts = new Map<string, { won: number; total: number }>();
  for (const lead of historicalLeads) {
    const trade = (lead.trade ?? "").toLowerCase().trim();
    if (!trade) continue;
    const entry = tradeCounts.get(trade) ?? { won: 0, total: 0 };
    entry.total++;
    if (lead.status === "won") entry.won++;
    tradeCounts.set(trade, entry);
  }

  for (const [trade, counts] of tradeCounts) {
    if (counts.total >= 3) {
      tradeRates.set(trade, counts.won / counts.total);
    }
  }

  return { zipRates, tradeRates };
}

/* ── CourtListener court name → USPS state code ──────────────────────────
 *
 * `liens_courtlistener.court` holds CL's court DISPLAY NAME, not a slug:
 *   "District Court, S.D. New York"                  -> NY
 *   "United States Bankruptcy Court, S.D. Texas"     -> TX
 *   "District Court, E.D. Tennessee"                 -> TN
 *   "Court of Appeals for the Ninth Circuit"         -> null (no state)
 *
 * Matching is longest-name-first so "West Virginia" wins over "Virginia"
 * and "North Carolina" over "Carolina". Circuit / SCOTUS rows name no
 * state and return null — they are dropped rather than mis-attributed.
 *
 * Read-side fix: needs no migration. The durable fix is to persist CL's
 * `court_id` slug (or a derived state_code) at ingest time and key off
 * that column instead of re-parsing a display string on every run. */
const COURT_NAME_TO_STATE: ReadonlyArray<readonly [string, string]> = (
  [
    ["alabama", "al"], ["alaska", "ak"], ["arizona", "az"], ["arkansas", "ar"],
    ["california", "ca"], ["colorado", "co"], ["connecticut", "ct"],
    ["delaware", "de"], ["district of columbia", "dc"], ["florida", "fl"],
    ["georgia", "ga"], ["hawaii", "hi"], ["idaho", "id"], ["illinois", "il"],
    ["indiana", "in"], ["iowa", "ia"], ["kansas", "ks"], ["kentucky", "ky"],
    ["louisiana", "la"], ["maine", "me"], ["maryland", "md"],
    ["massachusetts", "ma"], ["michigan", "mi"], ["minnesota", "mn"],
    ["mississippi", "ms"], ["missouri", "mo"], ["montana", "mt"],
    ["nebraska", "ne"], ["nevada", "nv"], ["new hampshire", "nh"],
    ["new jersey", "nj"], ["new mexico", "nm"], ["new york", "ny"],
    ["north carolina", "nc"], ["north dakota", "nd"], ["ohio", "oh"],
    ["oklahoma", "ok"], ["oregon", "or"], ["pennsylvania", "pa"],
    ["rhode island", "ri"], ["south carolina", "sc"], ["south dakota", "sd"],
    ["tennessee", "tn"], ["texas", "tx"], ["utah", "ut"], ["vermont", "vt"],
    ["virgin islands", "vi"], ["virginia", "va"], ["washington", "wa"],
    ["west virginia", "wv"], ["wisconsin", "wi"], ["wyoming", "wy"],
    ["puerto rico", "pr"], ["guam", "gu"],
  ] as ReadonlyArray<readonly [string, string]>
)
  .slice()
  .sort((a, b) => b[0].length - a[0].length);

function stateFromCourtName(court: string): string | null {
  const haystack = court.toLowerCase();
  for (const [name, code] of COURT_NAME_TO_STATE) {
    if (haystack.includes(name)) return code;
  }
  return null;
}

/* ── Value-forecast model cache (audit finding F) ────────────────────────
 *
 * The model is trained on up to 100,000 `leads` rows. That query + the
 * bucket build is the single most expensive non-permit operation in the
 * run, and it was paid once per HTTP invocation — which reads as "once"
 * only if you stop at this file. The scheduled run is a DRAIN: an external
 * loop (`scripts/_score_drain.mjs`, plus the admin trigger) calls this
 * endpoint back-to-back until the queue empties, so a single scheduled
 * pass rebuilt the same model dozens of times from the same rows.
 *
 * There is no inner batch loop in this handler to hoist the build out of,
 * so the equivalent fix one level up is a module-scoped memo: consecutive
 * invocations that land on a warm Node isolate reuse the model instead of
 * re-querying. A cold isolate rebuilds, which is correct — the cache is an
 * optimisation, never a correctness input.
 *
 * TTL is 10 minutes. The training set is historical won/quoted lead values
 * that move on a scale of days, so a 10-minute-stale model is
 * indistinguishable from a fresh one, while a drain pass finishes well
 * inside the window.
 */
const VALUE_MODEL_TTL_MS = 10 * 60 * 1000;
let cachedValueModel: { model: ValueModel; builtAt: number } | null = null;

/* ── Main cron handler ───────────────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Audit priority #8 (2026-04-28): inline 280s deadline check. Vercel
  // hard-kills at maxDuration=300; we leave 20s headroom so partial
  // results land cleanly and the cron's response object completes
  // before the executor disappears. Used in the per-permit scoring +
  // per-lead insert loops below to early-exit when the budget runs out.
  const t0 = Date.now();
  const deadlineMs = t0 + 280_000;
  const deadlineExceeded = (): boolean => Date.now() > deadlineMs;

  try {
    /* ── 1. Fetch unscored permits INSIDE a claimed territory ───────────── */

    // 2026-08-05 fix (audit finding A): this select carried NO territory
    // predicate. It pulled 1,000 arbitrary unscored permits, stamped
    // `scored_at` on ALL of them at step 7, and then built a lead only for
    // the subset whose ZIP resolved to an active territory. Because a permit
    // is considered for lead creation exactly once — at the moment it is
    // first scored — every permit in an unclaimed ZIP was permanently
    // burned: marked scored, never converted, never reconsidered.
    //
    // Measured on production 2026-08-05: 2,436,095 permits, 869,599 with a
    // ZIP, but only 10 ZIPs claimed (all Tampa FL). 240 runs/day of full
    // read + score + UPDATE work yielded ~1,000 leads — a 0.4% yield, and
    // the other 99.6% was destroyed on the way past.
    //
    // Restricting the queue to claimed ZIPs makes the cron pay only for
    // permits that can actually become leads. It COMPOSES with
    // /api/cron/territory-backfill rather than duplicating it: that route
    // owns recovery of the already-burned backlog (it clears `scored_at` on
    // lead-less permits inside claimed ZIPs when a territory is newly
    // bought); this predicate simply stops adding to that backlog.
    const { data: territoryZipRows, error: territoryZipErr } = await supabase
      .from("territories")
      .select("zip")
      .eq("status", "active");

    if (territoryZipErr) {
      throw new Error(`Failed to fetch active territories: ${territoryZipErr.message}`);
    }

    const claimedZips = [
      ...new Set((territoryZipRows ?? []).map((t) => t.zip).filter(Boolean)),
    ] as string[];

    // Audit finding B: the territory gate is correct product behaviour but
    // was completely invisible — 175 of the last 240 runs matched zero
    // territories and the summary said nothing at all. With no active
    // territory, no permit anywhere can become a lead, so scoring any is
    // pure waste. Return early, but say WHY in cron_runs.
    if (claimedZips.length === 0) {
      const emptySummary = {
        scored: 0,
        leadsCreated: 0,
        assigned: 0,
        notified: 0,
        active_territory_zips: 0,
        permits_considered: 0,
        permits_dropped_null_zip: 0,
        permits_dropped_no_territory: 0,
        permits_deferred_deadline: 0,
        note: "no active territories — nothing can become a lead",
      };
      await logCronRun("score", t0, {
        pulled: 0,
        inserted: 0,
        summary: emptySummary,
        trigger: detectTrigger(request),
      });
      return NextResponse.json({ success: true, summary: emptySummary });
    }

    // 2026-05-02 fix: LIMIT is 1000, not 5000, because a 5000-row SELECT
    // that includes raw_json (jsonb, ~10KB per row average) pulled ~50MB and
    // timed out the Supabase statement budget under concurrent UPDATE
    // pressure from the parallel enrich + backfill ops. Per-run throughput
    // is unchanged because the inner deadlineExceeded guard already caps
    // work at ~1000 permits per invocation.
    //
    // `.in()` values travel in the QUERY STRING (~8KB ceiling), so the ZIP
    // list is chunked at 200 — the same bound territory-backfill uses for
    // UUIDs. 200 five-char ZIPs is ~1.4KB of URL. Today there are 10 claimed
    // ZIPs and this loop runs once; the chunking exists so that growing to
    // hundreds of territories can never produce the silent 414 that
    // supabase-js does not surface as an error.
    const ZIP_IN_CHUNK = 200;
    const PERMIT_LIMIT = 1000;
    const permits: PermitRow[] = [];
    for (
      let i = 0;
      i < claimedZips.length && permits.length < PERMIT_LIMIT;
      i += ZIP_IN_CHUNK
    ) {
      const zipChunk = claimedZips.slice(i, i + ZIP_IN_CHUNK);
      const { data: page, error: fetchError } = await supabase
        .from("permits")
        .select("id, permit_type, status, description, address, city, state, zip, latitude, longitude, estimated_value, issued_date, applied_date, applicant_name, created_at, raw_json")
        .is("scored_at", null)
        .in("zip", zipChunk)
        // Audit finding E: freshness is the heaviest single component (0-20)
        // and it reads `issued_date` alone, so the order the queue is drained
        // in decides which permits get the limited per-run budget.
        //
        // The 2026-08-05 deep audit argued AGAINST this ordering, on two
        // grounds: newest-first would permanently starve the 16,611 unscored
        // permits with a NULL `issued_date`, and it would sort a 1.5M-row
        // unfiltered set. Both objections were measured against the
        // UNFILTERED select, and the claimed-ZIP predicate above defuses
        // both. The queue is now bounded by the claimed-ZIP permit count
        // (16,548 today), which drains completely at 1,000/run — so
        // NULLS LAST defers those rows by hours, it does not starve them —
        // and the sort runs over that same bounded set rather than the whole
        // corpus. Do NOT re-add this ordering if the ZIP predicate is ever
        // removed.
        .order("issued_date", { ascending: false, nullsFirst: false })
        .limit(PERMIT_LIMIT - permits.length);

      if (fetchError) {
        throw new Error(`Failed to fetch unscored permits: ${fetchError.message}`);
      }
      permits.push(...((page ?? []) as PermitRow[]));
    }

    if (permits.length === 0) {
      const emptySummary = {
        scored: 0,
        leadsCreated: 0,
        assigned: 0,
        notified: 0,
        active_territory_zips: claimedZips.length,
        permits_considered: 0,
        permits_dropped_null_zip: 0,
        permits_dropped_no_territory: 0,
        permits_deferred_deadline: 0,
        note: "no unscored permits inside a claimed territory",
      };
      await logCronRun("score", t0, {
        pulled: 0,
        inserted: 0,
        summary: emptySummary,
        trigger: detectTrigger(request),
      });
      return NextResponse.json({ success: true, summary: emptySummary });
    }

    /* ── 2. Gather enrichment data for scoring ─────────────────────────── */

    const uniqueZips = [...new Set(permits.map((p) => p.zip).filter(Boolean))] as string[];
    const uniqueTrades = [...new Set(
      permits.map((p) => (p.permit_type ?? "").toLowerCase().trim()).filter(Boolean)
    )];

    /* ZIP demand scores */
    const zipDemandMap = new Map<string, number>();
    if (uniqueZips.length > 0) {
      const { data: demandRows } = await supabase
        .from("zip_demand_scores")
        .select("zip, demand_score")
        .in("zip", uniqueZips);

      for (const row of demandRows ?? []) {
        zipDemandMap.set(row.zip, row.demand_score);
      }
    }

    /* Competitor counts per ZIP */
    const competitorMap = new Map<string, number>();
    if (uniqueZips.length > 0) {
      const { data: territories } = await supabase
        .from("territories")
        .select("zip")
        .in("zip", uniqueZips)
        .eq("status", "active");

      for (const t of territories ?? []) {
        competitorMap.set(t.zip, (competitorMap.get(t.zip) ?? 0) + 1);
      }
    }

    /* Historical conversion rates */
    const { zipRates, tradeRates } = await fetchConversionRates(
      supabase,
      uniqueZips,
      uniqueTrades
    );

    /* Module 13 — score calibration tables (00090).
     *
     * Pre-fetched once per cron run because both tables are tiny
     * (~7 rows trade, ~11 rows stage). Built into trade- and stage-
     * keyed maps; per-permit lookup is O(1). When the migration
     * isn't applied yet (or rows missing) the per-permit path falls
     * through to undefined → calibration is a no-op (weight=1.0,
     * cap=100, modifier=1.0). Honest about its own optionality. */
    const tradeWeightMap = new Map<string, TradeWeightRow>();
    const stageModifierMap = new Map<string, StageModifierRow>();
    try {
      const [{ data: tradeRows }, { data: stageRows }] = await Promise.all([
        supabase.from("score_trade_weights").select("*"),
        supabase.from("score_stage_modifiers").select("*"),
      ]);
      for (const r of tradeRows ?? []) {
        tradeWeightMap.set((r.trade as string).toLowerCase().trim(), {
          trade: r.trade as string,
          freshness_weight: Number(r.freshness_weight ?? 1.0),
          value_weight:     Number(r.value_weight     ?? 1.0),
          contact_weight:   Number(r.contact_weight   ?? 1.0),
          demand_weight:    Number(r.demand_weight    ?? 1.0),
        });
      }
      for (const r of stageRows ?? []) {
        stageModifierMap.set(r.stage as string, {
          stage: r.stage as string,
          cap: Number(r.cap ?? 100),
          base_modifier: Number(r.base_modifier ?? 1.0),
        });
      }
      logger.info("score.calibration_loaded", {
        tradeWeights: tradeWeightMap.size,
        stageModifiers: stageModifierMap.size,
      });
    } catch (e) {
      logger.warn("score.calibration_fetch_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    /* Phase AA-3 — ZIP pre-intent aggregates (migration 00093).
     *
     * The materialised view caches per-ZIP COUNT(*) FILTER aggregates
     * over recent permits. Reading it once per cron run lets every
     * lead's classifier call light up the 3 starved ZIP-aggregate
     * reason codes (`nearby_adu_activity_90d`,
     * `nearby_remodel_activity_90d`, `neighborhood_upgrade_trend`)
     * without each call hitting the underlying aggregate inline (which
     * was the original Z.2 timeout root cause).
     *
     * Graceful-degrade: when the view is missing or empty, the map
     * stays empty and the classifier sees null for all 3 inputs (no
     * change from the pre-AA-3 behaviour). */
    const zipAggMap = new Map<
      string,
      { adu_90d: number; remodel_180d: number; yoy_growth: number | null }
    >();
    try {
      const { data: zipRows, error: zipErr } = await supabase
        .from("zip_pre_intent_aggregates")
        .select("zip, adu_90d, remodel_180d, yoy_growth")
        .or("adu_90d.gte.1,remodel_180d.gte.1,yoy_growth.not.is.null");
      if (!zipErr) {
        for (const r of zipRows ?? []) {
          if (!r.zip) continue;
          zipAggMap.set(r.zip as string, {
            adu_90d: Number(r.adu_90d ?? 0),
            remodel_180d: Number(r.remodel_180d ?? 0),
            yoy_growth: r.yoy_growth == null ? null : Number(r.yoy_growth),
          });
        }
        logger.info("score.zip_aggregates_loaded", { zips: zipAggMap.size });
      }
    } catch (e) {
      logger.warn("score.zip_aggregates_fetch_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    /* Tier A+ Sprint 2 (F2.2) — value-forecast model.
     *
     * Build once per cron run from leads that DO have a permit_value
     * (the ~30% with actuals). Bucket on (permit_type × ZIP3 × year_built).
     * Used downstream to populate `predicted_value` for permits whose
     * `estimated_value` is null — the scoring engine treats it as the
     * value when no actual is present (model.ts buildSignals).
     *
     * Graceful-degrade: if the query errors or returns no training rows,
     * `valueModel` stays null and `predicted_value` is never populated —
     * scoring falls back to the no-value baseline (model.ts scoreValue
     * starts at 2, not 0).
     *
     * CORRECTION (2026-08-04 audit): an earlier version of this comment
     * claimed "no fabricated values ever flow into the scorer". They do —
     * a forecast that clears the gate below is used as the permit value.
     * The gate now requires `confidence !== "low"` so only bucket-specific
     * estimates qualify, but the score breakdown still renders the figure
     * without marking it as modeled. Threading an `isEstimated` flag
     * through ScoringSignals so signals.ts / model.ts can label it is the
     * outstanding half of this fix (both live in the scoring lib).
     *
     * Cap at 100k training rows to keep the cron query fast (~2s).
     *
     * Audit finding F: reuse a recently-built model rather than re-running
     * the 100k-row training query on every invocation of a multi-call drain
     * pass. See VALUE_MODEL_TTL_MS above for why a warm memo is safe here. */
    let valueModel: ValueModel | null = null;
    if (
      cachedValueModel != null &&
      Date.now() - cachedValueModel.builtAt < VALUE_MODEL_TTL_MS
    ) {
      valueModel = cachedValueModel.model;
      logger.info("value-forecast model reused", {
        buckets: valueModel.buckets.size,
        age_ms: Date.now() - cachedValueModel.builtAt,
      });
    } else {
      try {
        const { data: trainingRows } = await supabase
          .from("leads")
          .select("permit_type, zip, year_built, permit_value")
          .not("permit_value", "is", null)
          .gt("permit_value", 0)
          .limit(100_000);
        if (trainingRows && trainingRows.length > 0) {
          valueModel = buildValueModel(
            trainingRows.map((r) => ({
              permit_type: (r.permit_type as string | null) ?? null,
              zip: (r.zip as string | null) ?? null,
              year_built: (r.year_built as number | null) ?? null,
              estimated_value: r.permit_value as number,
            })),
          );
          cachedValueModel = { model: valueModel, builtAt: Date.now() };
          logger.info("value-forecast model built", {
            training_rows: trainingRows.length,
            buckets: valueModel.buckets.size,
          });
        }
      } catch (e) {
        logger.warn("value-forecast model build failed", {
          error: e instanceof Error ? e.message : String(e),
        });
        valueModel = null;
      }
    }

    /* Per-address history rollup (populates cascade_flag, pipeline_value, etc.)
     * Keyed by the same `address_norm` format used by build-address-history.ts.
     * `normalizeAddrKey` lives in `./helpers` so the round-robin + key-norm
     * logic is unit-testable in isolation. */
    const addrKeysSet = new Set<string>();
    for (const p of permits) {
      const k = normalizeAddrKey(p.address, p.zip);
      if (k) addrKeysSet.add(k);
    }
    const addrKeys = [...addrKeysSet];
    const historyMap = new Map<string, {
      permit_count: number;
      total_value: number | null;
      permits: unknown[];
      trades: string[];
    }>();
    // Batch in chunks of 50 to keep URL length under ~4KB (addresses can be
    // 100+ chars each). Larger batches intermittently trigger TypeError: fetch
    // failed from Node's fetch on oversized URLs.
    for (let i = 0; i < addrKeys.length; i += 50) {
      const chunk = addrKeys.slice(i, i + 50);
      try {
        const { data: histRows, error: histErr } = await supabase
          .from("address_permit_history")
          .select("address_norm, permit_count, total_value, permits, trades")
          .in("address_norm", chunk);
        if (histErr) {
          logger.warn("address_permit_history lookup failed", { error: histErr.message });
          continue;
        }
        for (const r of histRows ?? []) {
          historyMap.set(r.address_norm as string, {
            permit_count: r.permit_count as number,
            total_value: (r.total_value as number | null) ?? null,
            permits: (r.permits as unknown[]) ?? [],
            trades: (r.trades as string[]) ?? [],
          });
        }
      } catch (e) {
        logger.warn("address_permit_history lookup failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    /* Wave 1.5 — pre-fetch sidecar data so the scorer can populate the
     * two additive boosters (storm_proximity_24h, recent_lien_90d).
     *
     * Strategy: pull the small recent windows once, then bbox + state-
     * prefix them per permit in memory. That avoids 5,000 round-trips
     * to the SWDI tables in a single cron run.
     *
     * Graceful-degrade: when the sidecar tables are empty (Wave 1 cron
     * hasn't yet populated them) or migrations haven't applied, the
     * lookups silently return [] and the boosters stay at 0. Existing
     * scoring stays stable — no behavior change. */
    interface SwdiPoint {
      kind: "hail" | "wind" | "tornado";
      lat: number;
      lng: number;
      max_size_mm: number | null;
      max_wind_mph: number | null;
      probability: number | null;
    }
    const swdiPoints: SwdiPoint[] = [];
    try {
      const since24h = new Date(Date.now() - 86_400_000).toISOString();
      const [hailRes, windRes, tornadoRes] = await Promise.all([
        supabase
          .from("weather_swdi_hail")
          .select("lat, lng, max_size_mm, probability")
          .gte("event_time", since24h)
          .limit(50_000),
        supabase
          .from("weather_swdi_wind")
          .select("lat, lng, max_wind_mph")
          .gte("event_time", since24h)
          .limit(50_000),
        supabase
          .from("weather_swdi_tornado")
          .select("lat, lng")
          .gte("event_time", since24h)
          .limit(5_000),
      ]);
      for (const r of hailRes.data ?? []) {
        if (typeof r.lat === "number" && typeof r.lng === "number") {
          swdiPoints.push({
            kind: "hail",
            lat: r.lat, lng: r.lng,
            max_size_mm: typeof r.max_size_mm === "number" ? r.max_size_mm : null,
            max_wind_mph: null,
            probability: typeof r.probability === "number" ? r.probability : null,
          });
        }
      }
      for (const r of windRes.data ?? []) {
        if (typeof r.lat === "number" && typeof r.lng === "number") {
          swdiPoints.push({
            kind: "wind",
            lat: r.lat, lng: r.lng,
            max_size_mm: null,
            max_wind_mph: typeof r.max_wind_mph === "number" ? r.max_wind_mph : null,
            probability: null,
          });
        }
      }
      for (const r of tornadoRes.data ?? []) {
        if (typeof r.lat === "number" && typeof r.lng === "number") {
          swdiPoints.push({
            kind: "tornado",
            lat: r.lat, lng: r.lng,
            max_size_mm: null,
            max_wind_mph: null,
            probability: null,
          });
        }
      }
      logger.info("score.swdi_loaded", { count: swdiPoints.length });
    } catch (e) {
      logger.warn("score.swdi_load_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // ── Wave 2.A NRI lookup — county-level keyed lookup + state-level
    //    median fallback. The ~3k NRI counties fit comfortably in memory.
    //
    //    2026-05-11 fix: the original city↔county join only matched
    //    ~7% of permits (verified via SQL probe) because `permits.city`
    //    is a city name and `risk_nri_county.county_name` is a county
    //    name. They coincide only for "namesake" cities (Sacramento,
    //    Austin, etc.). The other 93% got null and the booster never
    //    fired.
    //
    //    To recover coverage we now ALSO pre-compute the MEDIAN risk
    //    score per state. When the city↔county lookup misses, we fall
    //    back to the state median — the "typical county in the state"
    //    rather than its worst county (state-max would saturate +3 for
    //    every state since each state has at least one extreme county).
    //
    //    Net effect vs. pre-fix: leads in high-risk states (CA / AZ /
    //    FL / NJ / HI median 88-95) get +3; mid-risk states (OR / SC /
    //    NC / LA / PA median 70-85) get +2-3; lower-risk states (WI /
    //    MD / OH / TN / TX median 53-64) get +1; truly low-risk states
    //    stay at 0. Leads where the city↔county lookup matched still
    //    get the precise county value (county lookup runs first).
    const nriByCounty = new Map<string, number>(); // key: "AL/Autauga" lowercased → risk_score
    const nriStateMedian = new Map<string, number>(); // key: "AL" lowercased → median risk_score
    try {
      const { data } = await supabase
        .from("risk_nri_county")
        .select("state_abbrv, county_name, risk_score")
        .not("risk_score", "is", null)
        .limit(5000);
      // First pass: county-keyed map + per-state collection for median.
      const stateRiskBuckets = new Map<string, number[]>();
      for (const r of data ?? []) {
        if (
          typeof r.state_abbrv === "string" &&
          typeof r.county_name === "string" &&
          typeof r.risk_score === "number"
        ) {
          const st = r.state_abbrv.toLowerCase();
          nriByCounty.set(`${st}/${r.county_name.toLowerCase()}`, r.risk_score);
          const bucket = stateRiskBuckets.get(st) ?? [];
          bucket.push(r.risk_score);
          stateRiskBuckets.set(st, bucket);
        }
      }
      // Second pass: compute median per state.
      for (const [st, scores] of stateRiskBuckets) {
        if (scores.length === 0) continue;
        scores.sort((a, b) => a - b);
        const mid = Math.floor(scores.length / 2);
        const median = scores.length % 2 === 0
          ? (scores[mid - 1] + scores[mid]) / 2
          : scores[mid];
        nriStateMedian.set(st, median);
      }
      logger.info("score.nri_loaded", {
        counties: nriByCounty.size,
        states_with_median: nriStateMedian.size,
      });
    } catch (e) {
      logger.warn("score.nri_load_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // ── Wave 2.B NFIP flood-claim density — bucket by 5-digit ZIP.
    const nfipCountByZip = new Map<string, number>();
    try {
      const { data } = await supabase
        .from("claims_nfip")
        .select("reported_zip_code")
        .not("reported_zip_code", "is", null)
        .limit(50_000);
      for (const r of data ?? []) {
        const z = typeof r.reported_zip_code === "string"
          ? r.reported_zip_code.slice(0, 5)
          : null;
        if (!z) continue;
        nfipCountByZip.set(z, (nfipCountByZip.get(z) ?? 0) + 1);
      }
      logger.info("score.nfip_loaded", {
        zips: nfipCountByZip.size,
        total: [...nfipCountByZip.values()].reduce((a, b) => a + b, 0),
      });
    } catch (e) {
      logger.warn("score.nfip_load_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // ── Wave 1 USGS recent quakes — last 365 days, M3.5+. Same
    //    bbox/haversine pattern as SWDI but lower density (~5k events
    //    nationwide per year, all of CONUS+AK fits easily).
    interface QuakePoint { lat: number; lng: number; magnitude: number; }
    const quakePoints: QuakePoint[] = [];
    try {
      const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
      const { data } = await supabase
        .from("quakes_usgs")
        .select("lat, lng, magnitude")
        .gte("event_time", since)
        .gte("magnitude", 3.5)
        .limit(20_000);
      for (const r of data ?? []) {
        if (
          typeof r.lat === "number" &&
          typeof r.lng === "number" &&
          typeof r.magnitude === "number"
        ) {
          quakePoints.push({ lat: r.lat, lng: r.lng, magnitude: r.magnitude });
        }
      }
      logger.info("score.quakes_loaded", { count: quakePoints.length });
    } catch (e) {
      logger.warn("score.quakes_load_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    /* Lien lookup — bucket by the state named in the CourtListener court.
     *
     * 2026-08-04 audit: this used to be `court.slice(0, 2)`, on the
     * assumption that `court` held a CL slug ("calsup" -> "ca"). It does
     * not — /api/cron/courtlistener-liens writes CL's court DISPLAY NAME
     * ("District Court, S.D. New York"), so every key came out as "di" and
     * the booster could never match a lead's state. Result: recent_lien_90d
     * scored 0 on all 200k+ scored leads and its breakdown row has never
     * rendered. Because the row is hidden when zero, it read as "no lien
     * activity" rather than a broken join.
     *
     * Parsing the state out of the display name is the read-side fix and
     * needs no migration. The durable fix is to persist CL's `court_id`
     * slug (or a derived state_code) in liens_courtlistener and key off
     * that column — see the ingest cron. */
    const lienCountByState = new Map<string, number>();
    try {
      const since90dDate = new Date(Date.now() - 90 * 86_400_000)
        .toISOString().slice(0, 10);
      const { data: lienRows } = await supabase
        .from("liens_courtlistener")
        .select("court")
        .gte("date_filed", since90dDate)
        .limit(50_000);
      for (const r of lienRows ?? []) {
        if (typeof r.court !== "string") continue;
        const st = stateFromCourtName(r.court);
        // Circuit / SCOTUS rows name no state — drop rather than guess.
        if (!st) continue;
        lienCountByState.set(st, (lienCountByState.get(st) ?? 0) + 1);
      }
      logger.info("score.liens_loaded", {
        states: lienCountByState.size,
        total: [...lienCountByState.values()].reduce((a, b) => a + b, 0),
      });
    } catch (e) {
      logger.warn("score.liens_load_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    /** Highest-magnitude SWDI signature within 25mi of (lat,lng), 0-100. */
    function stormProximityFor(lat: number | null, lng: number | null): number | null {
      if (lat == null || lng == null) return null;
      if (swdiPoints.length === 0) return null;
      let best = 0;
      // Coarse bbox prefilter to keep the haversine loop fast — skip
      // anything > ~0.5° away in either dim (≈ 35mi at 40°N).
      for (const p of swdiPoints) {
        if (Math.abs(p.lat - lat) > 0.5 || Math.abs(p.lng - lng) > 0.6) continue;
        const mi = haversineMi(lat, lng, p.lat, p.lng);
        if (mi > 25) continue;
        // Map kind/magnitude → 0-100 intensity score.
        let intensity = 30; // baseline for "near a signature"
        if (p.kind === "tornado") intensity = 95;
        else if (p.kind === "wind" && p.max_wind_mph != null) {
          if (p.max_wind_mph >= 75) intensity = 90;
          else if (p.max_wind_mph >= 50) intensity = 70;
          else if (p.max_wind_mph >= 30) intensity = 50;
        } else if (p.kind === "hail" && p.max_size_mm != null) {
          // 25mm = 1 inch (severe threshold), 50mm = 2 inch (significant)
          if (p.max_size_mm >= 50) intensity = 90;
          else if (p.max_size_mm >= 25) intensity = 70;
          else intensity = 45;
        }
        // Distance attenuation: subtract 1pt per mile beyond 5
        const attenuated = Math.max(0, intensity - Math.max(0, mi - 5));
        if (attenuated > best) best = attenuated;
      }
      return best > 0 ? best : null;
    }

    /** Lien count for the lead's state-abbrev (proxy via court slug). */
    function recentLienCountFor(state: string | null): number | null {
      if (!state) return null;
      const st = state.toLowerCase();
      const v = lienCountByState.get(st);
      return v != null ? v : null;
    }

    /** NRI risk score for a permit's (state, city).
     *
     *  Lookup order:
     *    1. county-level — city↔county_name match (works for "namesake"
     *       cities like Sacramento, Austin, etc., ~7% of permits)
     *    2. state-level — MEDIAN NRI risk_score across all counties in
     *       the state (fallback for the other ~93%)
     *    3. null — when state isn't on file
     *
     *  Median (not max) is the state-level fallback so high-risk states
     *  don't all saturate at +3. Booster tiers fire at median > 50;
     *  truly low-risk states (median < 50) stay at 0.
     */
    function nriRiskScoreFor(state: string | null, city: string | null): number | null {
      if (!state) return null;
      const st = state.toLowerCase();
      if (city) {
        const k = `${st}/${city.toLowerCase()}`;
        const countyVal = nriByCounty.get(k);
        if (countyVal != null) return countyVal;
      }
      const stateMedian = nriStateMedian.get(st);
      return stateMedian != null ? stateMedian : null;
    }

    /** NFIP claim count for a 5-digit ZIP. */
    function nfipCountFor(zip: string | null): number | null {
      if (!zip) return null;
      const z = zip.slice(0, 5);
      const v = nfipCountByZip.get(z);
      return v != null ? v : null;
    }

    /** Recent M3.5+ quakes within 50mi (last 365d). */
    function recentQuakeCountFor(lat: number | null, lng: number | null): number | null {
      if (lat == null || lng == null) return null;
      if (quakePoints.length === 0) return null;
      let n = 0;
      for (const q of quakePoints) {
        // Coarse bbox prefilter — 50mi ≈ 0.72° lat / ~0.9° lng at 40°N.
        if (Math.abs(q.lat - lat) > 0.75 || Math.abs(q.lng - lng) > 0.95) continue;
        if (haversineMi(lat, lng, q.lat, q.lng) <= 50) n += 1;
      }
      return n;
    }

    /* ── 3. Score every permit with the new engine ─────────────────────── */

    const scoredLeads: ScoredLead[] = permits.map((permit) => {
      /* Resolve the trade key from the SAME source the scorer already writes
       * to leads.trade — `raw_json.normalized_trade ?? permit_type` — so both
       * sides of the calibration join speak one vocabulary.
       *
       * permits.permit_type is the 8-value enum (residential / commercial /
       * demolition / renovation / new_construction / addition / repair /
       * other). score_trade_weights is seeded with trade NAMES (roofing /
       * hvac / solar / plumbing / electrical / adu / general). Keying off
       * permit_type alone made every lookup miss. `general` is the fallback
       * so enum-only rows land on a real calibration row rather than null. */
      const normalizedTrade = (
        permit.raw_json as Record<string, string> | null
      )?.normalized_trade;
      const trade = (
        normalizedTrade ??
        permit.permit_type ??
        "general"
      )
        .toLowerCase()
        .trim();
      const owner = extractOwnerFields(permit.raw_json);
      // Per-address history for cascade scoring (feeds engagement floor in
      // model.ts). Falls back to 1 permit when we have no rollup row.
      const addrKey = normalizeAddrKey(permit.address, permit.zip);
      const history = addrKey ? historyMap.get(addrKey) : undefined;
      const cascadeCount = history?.permit_count ?? 1;

      /* Tier A+ Sprint 2 (F2.2) — when the permit has no actual estimated_value,
       * try the value-forecast model. Returns null when the bucket has too few
       * samples to be meaningful (sample_size < 5 internally). Never overrides
       * an existing actual. */
      let predictedValue: number | null = null;
      if (permit.estimated_value == null && valueModel != null) {
        const yearBuilt =
          (permit.raw_json as Record<string, unknown> | null)?.year_built as
            | number
            | null
            | undefined ?? null;
        const forecast = forecastValue(
          {
            permit_type: permit.permit_type,
            zip: permit.zip,
            year_built: yearBuilt,
          },
          valueModel,
        );
        /* Confidence gate, not just sample size. The forecaster's
         * last-resort branch buckets on permit type alone and self-labels
         * `confidence: "low"`; with a 100k-row training set those coarse
         * buckets always clear `sample_size >= 20`, so the old gate admitted
         * a nationwide median for a bucket as broad as "residential" and the
         * score breakdown then rendered it as this permit's stated value.
         * Requiring a non-low confidence keeps modeled values to buckets
         * that are actually specific to the permit. */
        if (
          forecast &&
          forecast.sample_size >= 20 &&
          forecast.confidence !== "low"
        ) {
          predictedValue = forecast.predicted_value;
        }
      }

      const signals = buildSignals({
        permit: {
          issue_date: permit.issued_date ?? permit.applied_date,
          estimated_value: permit.estimated_value,
          predicted_value: predictedValue,
          description: permit.description,
          permit_type: permit.permit_type,
          zip: permit.zip,
          created_at: permit.created_at,
        },
        /* Pre-populate lead signals from permit-level data */
        lead: {
          owner_name: owner.full ?? permit.applicant_name,
          owner_first: owner.first,
          owner_last: owner.last,
          phone: owner.phone,
          email: owner.email,
          trade: normalizedTrade ?? permit.permit_type,
          cascadeCount,
        },
        zipDemandScore: permit.zip ? zipDemandMap.get(permit.zip) ?? null : null,
        competitorCount: permit.zip ? competitorMap.get(permit.zip) ?? 0 : 0,
        zipConversionRate: permit.zip ? zipRates.get(permit.zip) ?? null : null,
        tradeConversionRate: trade ? tradeRates.get(trade) ?? null : null,
        // Wave 1.5 — sidecar boosters (SWDI proximity + recent liens).
        // Both default to null when the sidecar tables are empty so the
        // boost path is a no-op until the data lands.
        stormProximity24h: stormProximityFor(permit.latitude, permit.longitude),
        recentLienCount: recentLienCountFor(permit.state),
        // Wave 2.A / 2.B — FEMA NRI tier, NFIP flood-claim density,
        // recent USGS earthquakes. All graceful-degrade to null when
        // their respective sidecars are empty.
        nriRiskScore: nriRiskScoreFor(permit.state, permit.city),
        nfipClaimCount: nfipCountFor(permit.zip),
        recentQuakeCount: recentQuakeCountFor(permit.latitude, permit.longitude),
      });

      // Module 1 — classify opportunity_stage + reason_codes for this
      // permit BEFORE scoring so the stage modifier (Module 13) can be
      // looked up. Pure function; no I/O. The classifier reads many
      // optional fields from the permit row + signals — anything
      // missing falls through and the classifier still emits a
      // best-effort stage.
      const rawJsonForClassify = (permit.raw_json ?? {}) as Record<string, unknown>;
      // Phase AA-3 — pull pre-computed ZIP aggregate for this permit's
      // ZIP. Lights up the trio of pre-intent reason codes that depend
      // on neighbourhood activity:
      //   nearby_adu_activity_90d
      //   nearby_remodel_activity_90d
      //   neighborhood_upgrade_trend
      // Falls through to null when the view is unpopulated or this
      // permit's ZIP isn't in the map (no aggregate signal → no boost).
      const zipAgg = permit.zip ? zipAggMap.get(permit.zip) : undefined;

      const classified = classifyIntent({
        permit_status: permit.status,
        permit_type: permit.permit_type,
        permit_description: permit.description,
        permit_value: permit.estimated_value,
        // Unknown filing date leaves permitAge = +Infinity; pass null so the
        // classifier's `ageDays != null` guards don't read Infinity > 90 and
        // mislabel a submitted permit with no date as "stalled".
        permit_age_days: Number.isFinite(signals.permitAge) ? signals.permitAge : null,
        contractor_name:
          (rawJsonForClassify.contractor_name as string | null) ?? null,
        applicant_name: permit.applicant_name,
        applicant_classification:
          (rawJsonForClassify.applicant_classification as string | null) ?? null,
        year_built: (rawJsonForClassify.year_built as number | null) ?? null,
        owner_name: signals.hasOwnerName ? owner.full ?? permit.applicant_name : null,
        owner_occupied: signals.ownerOccupied,
        cascade_count: cascadeCount,
        is_homeowner_intake: false, // homeowner intakes flow through /api/intake, not this cron
        // Phase AA-3 ZIP-aggregate inputs (matview-backed)
        zip_adu_permits_90d: zipAgg?.adu_90d ?? null,
        zip_remodel_permits_90d: zipAgg?.remodel_180d ?? null,
        // upgrade-trend code wants a boolean — treat ≥10% YoY growth as
        // a positive upgrade trend, anything below as null/false.
        zip_neighbor_upgrade_trend:
          zipAgg?.yoy_growth != null && zipAgg.yoy_growth >= 0.1 ? true : null,
      });

      // Module 13 — look up per-trade weights and per-stage modifier.
      // Both default to undefined when the row is missing; the
      // calibration is then a safe no-op.
      const calibration: ScoreCalibration = {
        tradeWeights: tradeWeightMap.get(trade) ?? null,
        stageModifier: classified.stage
          ? stageModifierMap.get(classified.stage) ?? null
          : null,
      };

      const result = calculateScore(signals, calibration);
      // Phase 0a — build structured per-signal breakdown alongside the
      // numeric totals. Written to `leads.score_signals` below; if the
      // column doesn't exist yet (pre-migration 00031) the upsert path
      // strips it via the try/catch around DB writes.
      const scoreSignals = buildScoreSignalBreakdown(result, signals);

      return {
        permit,
        score: result.total,
        urgency: result.urgency,
        reasoning: result.factors.join("; ") || "Standard scoring applied",
        freshness: result.freshness,
        value: result.value,
        contact: result.contact,
        demand: result.demand,
        engagement: result.engagement,
        conversion: result.conversion,
        factors: result.factors,
        score_signals: scoreSignals,
        opportunity_stage: classified.stage,
        reason_codes: classified.reason_codes,
      };
    });

    /* ── 4. Pre-compute contractor assignments (round-robin by ZIP) ──── */

    const leadZips = [...new Set(scoredLeads.map((sl) => sl.permit.zip).filter(Boolean))] as string[];

    const { data: territoryRows, error: territoryErr } = await supabase
      .from("territories")
      .select("zip, contractor_id, profiles!inner(id, phone, email, full_name)")
      .in("zip", leadZips)
      .eq("status", "active");
    if (territoryErr) {
      logger.error("score.territory_query_failed", {
        error: territoryErr.message,
        leadZipsCount: leadZips.length,
      });
    } else {
      logger.info("score.territory_query_done", {
        leadZipsCount: leadZips.length,
        territoryRowsCount: territoryRows?.length ?? 0,
      });
    }

    /* Build ZIP -> contractors map */
    const zipToContractors = new Map<
      string,
      Array<{ id: string; phone?: string; email?: string; name?: string }>
    >();

    for (const t of territoryRows ?? []) {
      const profile = Array.isArray(t.profiles)
        ? (t.profiles as Record<string, string>[])[0]
        : (t.profiles as Record<string, string>);

      const contractors = zipToContractors.get(t.zip) ?? [];
      contractors.push({
        id: t.contractor_id,
        phone: profile?.phone,
        email: profile?.email,
        name: profile?.full_name,
      });
      zipToContractors.set(t.zip, contractors);
    }

    /* Round-robin counters per ZIP */
    const zipCounters = new Map<string, number>();

    /* ── 5. Insert leads with contractor assignment ────────────────────── */

    /* For each scored lead × each contractor in that ZIP, create a lead.
     * This supports the multi-contractor-per-territory model. */
    const leadsToInsert: Array<Record<string, unknown>> = [];

    /* Track which contractor gets which scored lead for notifications */
    const assignmentMap = new Map<string, { scored: ScoredLead; contractor: { id: string; phone?: string; email?: string; name?: string } }>();

    /* Audit finding B — the loop below drops permits in three distinct ways
     * and, until now, said nothing about any of them. A run that produced
     * zero leads was indistinguishable from a run that had nothing to do.
     * These three counters are surfaced in the cron_runs summary so an
     * operator can tell "no territory matched" apart from "no ZIP on the
     * permit" apart from "we ran out of time". */
    let permitsDroppedNullZip = 0;
    let permitsDroppedNoTerritory = 0;
    let permitsDeferredDeadline = 0;

    for (const [slIndex, sl] of scoredLeads.entries()) {
      // Audit priority #8: inline 280s deadline. The lead-build loop is
      // the heaviest part of the cron (rules engine + LLM mining +
      // signal-jsonb construction). Bail early so the orchestrator still
      // gets to write the leads it has prepared so far.
      if (deadlineExceeded()) {
        permitsDeferredDeadline = scoredLeads.length - slIndex;
        logger.warn("score cron deadline reached during lead build", {
          processedLeads: leadsToInsert.length,
          remainingScored: permitsDeferredDeadline,
          elapsedMs: Date.now() - t0,
        });
        break;
      }
      const zip = sl.permit.zip;
      if (!zip) {
        permitsDroppedNullZip += 1;
        continue;
      }
      const contractors = zipToContractors.get(zip);

      if (contractors && contractors.length > 0) {
        /* Round-robin: one lead per contractor in this ZIP */
        const counter = zipCounters.get(zip) ?? 0;
        const contractor = contractors[counter % contractors.length];
        zipCounters.set(zip, counter + 1);

        const rawJson = sl.permit.raw_json as Record<string, string> | null;
        const owner = extractOwnerFields(sl.permit.raw_json);
        // Look up per-address history for cascade detection + pipeline rollup.
        const addrKey = normalizeAddrKey(sl.permit.address, sl.permit.zip);
        const history = addrKey ? historyMap.get(addrKey) : undefined;
        const cascadeFlag = !!history && history.permit_count >= 2;
        const cascadeCount = history?.permit_count ?? 1;
        const pipelineValue =
          history?.total_value ?? sl.permit.estimated_value ?? null;
        const permitHistoryJson = history?.permits ?? [];

        // Phase 1.2: Predictive cross-trade rules engine. Builds a
        // synthetic Lead-shaped context and evaluates the 8 rules.
        // Output is jsonb written to leads.cross_trade_suggestions
        // (migration 00045). Gated on WRITE_CROSS_TRADE_SUGGESTIONS=1
        // env so pre-migration deploys silently skip the column.
        // The synthetic Lead avoids importing the full Lead type's
        // strict shape — only the fields the rules read are populated.
        let crossTradeSuggestions: ReturnType<typeof evaluateRules> = [];
        if (process.env.WRITE_CROSS_TRADE_SUGGESTIONS === "1") {
          try {
            const syntheticLead = {
              trade: rawJson?.normalized_trade ?? sl.permit.permit_type,
              permit_type: sl.permit.permit_type,
              permit_description: sl.permit.description,
              year_built: null,           // not yet populated by scorer
              owner_since: null,          // not yet populated by scorer
              cascade_count: cascadeCount,
            } as unknown as Lead;
            const predictiveHistory: AddressPermitHistory | null = history
              ? ({
                  address_norm: addrKey ?? "",
                  address: sl.permit.address ?? "",
                  city: sl.permit.city ?? null,
                  state: sl.permit.state ?? null,
                  zip: sl.permit.zip ?? null,
                  permit_count: history.permit_count,
                  total_value: history.total_value,
                  first_permit_date: null,
                  last_permit_date: null,
                  trades: history.trades ?? [],
                  // Cast through unknown — runtime shape from address_permit_history
                  // jsonb is compatible with HistoryPermit (subset of the same schema),
                  // but TypeScript can't prove it across the supabase-js boundary.
                  permits: (history.permits ?? []) as unknown as AddressPermitHistory["permits"],
                } as AddressPermitHistory)
              : null;
            crossTradeSuggestions = evaluateRules({
              lead: syntheticLead,
              history: predictiveHistory,
            });

            // Phase 2.1: Layer 2 — LLM description-mining. Layered on
            // TOP of the deterministic rules to catch cross-trade
            // signals buried in free-text descriptions (paver deck,
            // tile shower, skylight install, etc.). Gated by
            // LLM_MINING_ENABLED so contractors can disable until
            // they're ready to pay for LLM costs.
            if (
              process.env.LLM_MINING_ENABLED === "1" &&
              sl.permit.description
            ) {
              try {
                const llmSuggestions = await mineDescription(
                  {
                    description: sl.permit.description,
                    primaryTrade: syntheticLead.trade ?? "general",
                    permitId: sl.permit.id,
                  },
                  getMiningLlmClient(),
                );
                crossTradeSuggestions = mergeSuggestions(
                  crossTradeSuggestions,
                  llmSuggestions,
                );
              } catch (llmErr) {
                // LLM never blocks scoring — log + continue with
                // deterministic-only suggestions.
                logger.warn("LLM mining failed (graceful-degrade)", {
                  permitId: sl.permit.id,
                  error: String(llmErr),
                });
              }
            }
          } catch (e) {
            // Defensive: predictive rules are best-effort. A bug in
            // the engine should never block lead creation.
            logger.warn("Predictive rules eval failed", {
              permitId: sl.permit.id,
              error: String(e),
            });
          }
        }

        leadsToInsert.push({
          permit_id: sl.permit.id,
          contractor_id: contractor.id,
          score: sl.score,
          score_reasoning: sl.reasoning,
          score_model: "henri-scoring-v3",
          urgency: sl.urgency,
          // `status` is DELIBERATELY ABSENT. This payload goes through an
          // upsert with ignoreDuplicates:false, which overwrites every
          // column it is given — so sending status:"new" reset a
          // contractor's won/quoted/contacted lead back to "new" on every
          // re-score, while leaving contacted_at/won_at populated (an
          // internally contradictory row). `leads.status` has a DB default
          // of 'new'::lead_status, so omitting it gives new rows the right
          // value and leaves existing pipeline state untouched.
          zip: sl.permit.zip,
          address: sl.permit.address,
          city: sl.permit.city,
          state: sl.permit.state,
          latitude: sl.permit.latitude,
          longitude: sl.permit.longitude,
          permit_type: sl.permit.permit_type,
          permit_value: sl.permit.estimated_value,
          permit_description: sl.permit.description,
          trade: rawJson?.normalized_trade ?? sl.permit.permit_type,
          // Owner fields: multi-casing extractor pulls from whatever the
          // upstream feed actually ships. full-name falls back to
          // applicant_name (permits.applicant_name is a top-level column
          // on some feeds, not in raw_json).
          owner_name: owner.full ?? sl.permit.applicant_name,
          owner_first: owner.first,
          owner_last: owner.last,
          phone: owner.phone,
          email: owner.email,
          score_freshness: sl.freshness,
          score_value: sl.value,
          score_contact: sl.contact,
          score_demand: sl.demand,
          score_engagement: sl.engagement,
          score_conversion: sl.conversion,
          // Phase 0a transparency — written only when column exists.
          // The PostgREST upsert will strip unknown columns as long as
          // `prefer=return=minimal` or the schema cache refresh picks
          // up the new column. Pre-migration, the client-side fallback
          // (legacy numeric fields) keeps rendering correctly.
          score_signals: sl.score_signals,
          // Per-address history enrichment (Phase 5 of Data Henri 3 ingest)
          cascade_flag: cascadeFlag,
          cascade_count: cascadeCount,
          pipeline_value: pipelineValue,
          permit_history: permitHistoryJson,
          // Phase 1.2 predictive cross-trade suggestions. Only included
          // when WRITE_CROSS_TRADE_SUGGESTIONS=1 — empty array otherwise
          // so the upsert payload shape stays stable. The retry-on-
          // missing-column path below strips this field if migration
          // 00045 hasn't applied yet.
          cross_trade_suggestions:
            crossTradeSuggestions.length > 0 ? crossTradeSuggestions : null,
          // Module 1 — opportunity_stage + reason_codes (migration 00087).
          // Same retry-on-missing-column resilience pattern as
          // score_signals + cross_trade_suggestions: when the column
          // doesn't exist (pre-migration deploy), the catch path
          // below strips them and re-tries the insert.
          opportunity_stage: sl.opportunity_stage,
          reason_codes: sl.reason_codes,
          // `notes` is DELIBERATELY ABSENT for the same reason as `status`.
          // It is the CONTRACTOR'S free-text field — written by
          // /api/leads/[id]/notes and edited in the drawer — and the
          // overwriting upsert meant every re-score replaced whatever they
          // had typed with "Scoring factors: ...". The factors were never
          // unique to that field anyway: they are already carried by
          // `score_reasoning` and, in full structured form, by
          // `score_signals`, which is what the drawer's transparency
          // breakdown actually renders.
        });

        assignmentMap.set(`${sl.permit.id}:${contractor.id}`, { scored: sl, contractor });
      } else {
        /* A ZIP that came back from the claimed-territory query but has no
         * contractor after the `profiles!inner` join. `territories.
         * contractor_id` references `profiles(id)`, so this should be
         * unreachable — count it rather than let it vanish, because if it
         * ever fires it means the two territory queries disagree. */
        permitsDroppedNoTerritory += 1;
      }
    }

    let assignedCount = 0;
    let notifiedCount = 0;

    /* Audit finding A (second half) — permit ids that actually produced a
     * lead row. Only these get `scored_at` stamped at step 7; see the
     * comment there for why the rest are deliberately left NULL. */
    const leadProducingPermitIds = new Set<string>();

    if (leadsToInsert.length > 0) {
      // Use UPSERT on (permit_id, contractor_id) so the scorer is idempotent —
      // re-running after a scored_at reset or claiming more territories won't
      // violate the unique constraint when the same (permit, contractor) pair
      // already has a lead. `ignoreDuplicates: false` means existing rows get
      // their scoring fields refreshed with the latest model output.
      let insertResult = await supabase
        .from("leads")
        .upsert(leadsToInsert, {
          onConflict: "permit_id,contractor_id",
          ignoreDuplicates: false,
        })
        .select("id, zip, permit_id, contractor_id, score, urgency");

      // Phase 0a resilience — `score_signals` is only present after
      // migration 00031 lands. If the upsert 400s with a schema-cache
      // miss, retry once with that field stripped. Keeps the scorer
      // working both before and after the migration is applied.
      if (insertResult.error && /score_signals/i.test(insertResult.error.message)) {
        logger.warn("score_signals column missing \u2014 stripping + retrying (migration 00031 pending)");
        const stripped = leadsToInsert.map((row) => {
          const { score_signals: _omit, ...rest } = row as Record<string, unknown>;
          return rest;
        });
        insertResult = await supabase
          .from("leads")
          .upsert(stripped, {
            onConflict: "permit_id,contractor_id",
            ignoreDuplicates: false,
          })
          .select("id, zip, permit_id, contractor_id, score, urgency");
      }

      // Phase 1.2 resilience — `cross_trade_suggestions` is only present
      // after migration 00045 lands. Same strip-and-retry pattern as
      // score_signals above. Keeps the scorer working pre-migration.
      if (
        insertResult.error &&
        /cross_trade_suggestions/i.test(insertResult.error.message)
      ) {
        logger.warn(
          "cross_trade_suggestions column missing \u2014 stripping + retrying (migration 00045 pending)",
        );
        const stripped = leadsToInsert.map((row) => {
          const { cross_trade_suggestions: _omit, ...rest } =
            row as Record<string, unknown>;
          return rest;
        });
        insertResult = await supabase
          .from("leads")
          .upsert(stripped, {
            onConflict: "permit_id,contractor_id",
            ignoreDuplicates: false,
          })
          .select("id, zip, permit_id, contractor_id, score, urgency");
      }

      // Module 1 resilience \u2014 `opportunity_stage` + `reason_codes` are
      // only present after migration 00087 lands. Strip both and retry
      // when either column is missing.
      if (
        insertResult.error &&
        /(opportunity_stage|reason_codes)/i.test(insertResult.error.message)
      ) {
        logger.warn(
          "opportunity_stage/reason_codes columns missing \u2014 stripping + retrying (migration 00087 pending)",
        );
        const stripped = leadsToInsert.map((row) => {
          const { opportunity_stage: _o, reason_codes: _r, ...rest } =
            row as Record<string, unknown>;
          return rest;
        });
        insertResult = await supabase
          .from("leads")
          .upsert(stripped, {
            onConflict: "permit_id,contractor_id",
            ignoreDuplicates: false,
          })
          .select("id, zip, permit_id, contractor_id, score, urgency");
      }

      const { data: insertedLeads, error: insertError } = insertResult;
      if (insertError) {
        throw new Error(`Failed to insert leads: ${insertError.message}`);
      }

      assignedCount = insertedLeads?.length ?? 0;
      for (const l of insertedLeads ?? []) {
        if (l.permit_id) leadProducingPermitIds.add(l.permit_id as string);
      }

      /* ── 6. Send notifications ───────────────────────────────────────── */

      const notificationInserts: Array<{
        user_id: string;
        type: string;
        title: string;
        body: string;
        read: boolean;
      }> = [];

      for (const lead of insertedLeads ?? []) {
        const key = `${lead.permit_id}:${lead.contractor_id}`;
        const assignment = assignmentMap.get(key);
        if (!assignment) continue;

        // Only notify on hot/warm leads. Earlier code fired a
        // notification per inserted lead regardless of urgency, which
        // accumulated 289k unread "new_lead" notifications for the
        // founder account (mostly cool/cold) and made the
        // notifications API take 3-5s per request as it paginated
        // through the unread backlog. Cool (25-49) and cold (0-24)
        // leads are background data — a contractor doesn't need a
        // push notification for every score-cron tick. Hot (75+) and
        // warm (50-74) keep the wedge promise of "speed-to-lead."
        if (lead.urgency !== "hot" && lead.urgency !== "warm") continue;

        notificationInserts.push({
          user_id: lead.contractor_id,
          type: "new_lead",
          title: "New permit lead in your territory",
          body: `A new ${assignment.scored.permit.permit_type ?? "permit"} was filed in ZIP ${lead.zip}. Score: ${lead.score}/100 (${lead.urgency}).`,
          read: false,
        });
      }

      if (notificationInserts.length > 0) {
        const { error: notifError } = await supabase
          .from("notifications")
          .insert(notificationInserts);

        if (!notifError) {
          notifiedCount = notificationInserts.length;
        } else {
          logger.error("Notification insert error", { error: String(notifError) });
        }
      }

      /* Fire SMS for hot leads (non-blocking) */
      const hotLeads = (insertedLeads ?? []).filter((l) => l.score >= 75);

      if (hotLeads.length > 0) {
        Promise.allSettled(
          hotLeads.map(async (hl) => {
            const key = `${hl.permit_id}:${hl.contractor_id}`;
            const assignment = assignmentMap.get(key);
            if (!assignment) return;

            if (assignment.contractor.phone && process.env.TWILIO_ACCOUNT_SID) {
              try {
                const { sendLeadSMS } = await import("@/lib/twilio/sms");
                await sendLeadSMS(
                  assignment.contractor.phone,
                  {
                    permitType: assignment.scored.permit.permit_type ?? "Hot lead",
                    address: `ZIP ${hl.zip ?? ""}`,
                    city: assignment.scored.permit.city ?? "",
                    state: assignment.scored.permit.state ?? "",
                    description:
                      assignment.scored.factors.slice(0, 3).join(". ") ??
                      "New high-score permit lead in your territory",
                    estimatedValue: assignment.scored.permit.estimated_value ?? null,
                    score: hl.score,
                    urgency: hl.urgency as "hot" | "warm" | "cool" | "cold",
                  },
                  // Module 7 wiring — permit-derived hot leads have no
                  // intake; consent gate is naturally bypassed (returns
                  // null homeowner_intake_id). Quiet-hours gate still
                  // applies via the lead's ZIP.
                  { homeownerIntakeId: null, zip: hl.zip ?? null },
                );
              } catch (e) {
                logger.error("SMS notification error", { error: String(e) });
              }
            }
          })
        ).catch((err) => logger.error("Hot lead SMS batch error", { error: String(err) }));
      }

      /* Module 14 — alert_rules evaluator (Phase AA).
       *
       * Fan-out: for each contractor that received an inserted lead,
       * load their enabled alert_rules once + evaluate against the
       * subset of leads that landed in their bucket. Hits dispatch
       * via email (Resend) or SMS (sendLeadSMS, hygiene-gated). The
       * evaluator is best-effort; a thrown error never blocks the
       * cron's primary path. Cross-run dedupe via last_fired_at
       * (24h window) lives inside dispatchAlertHits. */
      try {
        const leadsByContractor = new Map<string, typeof insertedLeads>();
        for (const lead of insertedLeads ?? []) {
          const arr = leadsByContractor.get(lead.contractor_id) ?? [];
          arr.push(lead);
          leadsByContractor.set(lead.contractor_id, arr);
        }

        if (leadsByContractor.size > 0) {
          const { evaluateRules } = await import("@/lib/alerts/evaluate");
          const { dispatchAlertHits } = await import("@/lib/alerts/dispatch");
          const allHits: Awaited<ReturnType<typeof evaluateRules>> = [];

          for (const [contractorId, contractorLeads] of leadsByContractor.entries()) {
            const { data: rules } = await supabase
              .from("alert_rules")
              .select("id, contractor_id, kind, criteria, enabled, channel, last_fired_at, fire_count")
              .eq("contractor_id", contractorId)
              .eq("enabled", true);

            if (!rules || rules.length === 0) continue;

            // Project contractor's leads into the AlertEvaluationLead shape.
            const evalLeads = (contractorLeads ?? []).map((l) => {
              const key = `${l.permit_id}:${l.contractor_id}`;
              const assignment = assignmentMap.get(key);
              return {
                id: l.id,
                contractor_id: l.contractor_id,
                score: l.score,
                trade: assignment?.scored.permit.permit_type ?? null,
                zip: l.zip,
                address: assignment?.scored.permit.address ?? null,
                permit_number: null,
                permit_description: assignment?.scored.permit.description ?? null,
                opportunity_stage: assignment?.scored.opportunity_stage ?? null,
                is_homeowner_intake: false,
                previous_stage: null,
              };
            });

            const hits = evaluateRules(rules as Parameters<typeof evaluateRules>[0], evalLeads);
            allHits.push(...hits);
          }

          if (allHits.length > 0) {
            const summary = await dispatchAlertHits(allHits);
            logger.info("alerts.dispatched", {
              hits: allHits.length,
              ...summary,
            });
          }
        }
      } catch (alertErr) {
        // Best-effort — alerts never block the cron.
        logger.warn("alerts.evaluator_failed", {
          error: alertErr instanceof Error ? alertErr.message : String(alertErr),
        });
      }
    }

    /* ── 7. Mark permits as scored ─────────────────────────────────────── */
    /*
     * Audit fix 2026-05-02: the original single-shot
     *   .update(...).in("id", permitIds)
     * silently failed once permitIds passed ~250 rows. PostgREST builds
     * `id=in.(uuid,uuid,...)` into the GET query string of the PATCH and
     * Supabase's edge proxy rejects URLs over ~8KB, returning 414/empty.
     * supabase-js doesn't surface that as an error from .update(), so
     * the cron looked successful while the same 1000 permits got
     * re-fetched on every run — backlog stuck at 817,739.
     *
     * Fix: chunk into 200-id batches (~7.4KB URL ceiling) and explicitly
     * capture errors so any future regression is visible in cron_runs.
     *
     * 2026-08-05 fix (audit finding A, second half): this stamped EVERY
     * permit the run fetched, including the ones that never produced a lead.
     * `scored_at` is the queue cursor — stamping it is what made a
     * non-converted permit unreachable forever. It now stamps only the
     * permits that actually landed a lead row, so anything the run could
     * not convert stays NULL and re-enters the queue on the next pass.
     *
     * This does NOT create an endless re-score loop, for two reasons.
     * First, the queue is now bounded by the claimed-ZIP predicate at step
     * 1, so a permit left NULL is retried against a small fixed set rather
     * than competing with 2.4M rows. Second, the only two ways to reach
     * this point without a lead are (a) the 280s deadline cut the lead-build
     * loop short, which is transient and resolves on the very next run, and
     * (b) a claimed ZIP whose contractor has no `profiles` row — which the
     * `territories.contractor_id -> profiles(id)` FK makes unreachable, and
     * which `permits_dropped_no_territory` in the summary would expose if it
     * ever happened. Leaving these rows NULL also keeps them invisible to
     * /api/cron/territory-backfill, whose scan filters on
     * `scored_at IS NOT NULL` — so the two routes cannot fight over the same
     * row by alternately setting and clearing the cursor.
     */
    const permitIds = [...leadProducingPermitIds];
    const scoredAt = new Date().toISOString();
    let scoredAtUpdated = 0;
    let scoredAtErrors = 0;
    const SCORED_AT_BATCH = 200;
    for (let i = 0; i < permitIds.length; i += SCORED_AT_BATCH) {
      const chunk = permitIds.slice(i, i + SCORED_AT_BATCH);
      const { error: updErr, count } = await supabase
        .from("permits")
        .update({ scored_at: scoredAt }, { count: "exact" })
        .in("id", chunk);
      if (updErr) {
        scoredAtErrors++;
        logger.error("score.permits-scored_at-update-failed", {
          batch_start: i,
          batch_size: chunk.length,
          error: updErr.message,
        });
      } else {
        scoredAtUpdated += count ?? chunk.length;
      }
    }
    logger.info("score.permits-scored_at-updated", {
      total_permits: permitIds.length,
      updated: scoredAtUpdated,
      batch_errors: scoredAtErrors,
    });

    const responseBody = {
      success: true,
      summary: {
        scored: scoredLeads.length,
        leadsCreated: assignedCount,
        assigned: assignedCount,
        notified: notifiedCount,
        // Diagnostic fields for the audit pass — surfaces where the
        // assignment pipeline drops permits.
        //
        // Audit finding B: the three `permits_dropped_*` / `_deferred_`
        // counters plus `active_territory_zips` are what make a zero-lead
        // run self-explaining. Before them, a run that matched no territory
        // and a run with nothing to do produced byte-identical summaries.
        active_territory_zips: claimedZips.length,
        permits_considered: permits.length,
        permits_dropped_null_zip: permitsDroppedNullZip,
        permits_dropped_no_territory: permitsDroppedNoTerritory,
        permits_deferred_deadline: permitsDeferredDeadline,
        unique_lead_zips: leadZips.length,
        territory_rows: territoryRows?.length ?? 0,
        zip_to_contractors_map_size: zipToContractors.size,
        leads_to_insert_count: leadsToInsert.length,
        permits_marked_scored: scoredAtUpdated,
        permits_mark_errors: scoredAtErrors,
        scoreDistribution: {
          hot: scoredLeads.filter((sl) => sl.urgency === "hot").length,
          warm: scoredLeads.filter((sl) => sl.urgency === "warm").length,
          cool: scoredLeads.filter((sl) => sl.urgency === "cool").length,
          cold: scoredLeads.filter((sl) => sl.urgency === "cold").length,
        },
        avgScore:
          scoredLeads.length > 0
            ? Math.round(
                scoredLeads.reduce((sum, sl) => sum + sl.score, 0) /
                  scoredLeads.length
              )
            : 0,
      },
    };
    // Pass the inner summary object — not `responseBody` which wraps
    // it under `{success: true, summary: {...}}`. The earlier shape
    // double-nested in cron_runs as `summary->'summary'->>'leadsCreated'`,
    // breaking every probe that read `summary->>'leadsCreated'` directly.
    await logCronRun("score", t0, {
      pulled: scoredLeads.length,
      inserted: assignedCount,
      summary: responseBody.summary,
      trigger: detectTrigger(request),
    });
    return NextResponse.json(responseBody);
  } catch (err) {
    logger.error("Lead scoring cron error", { error: String(err) });
    await logCronRun("score", t0, {
      error: String(err),
      trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "Lead scoring failed", detail: String(err) },
      { status: 500 }
    );
  }
}
