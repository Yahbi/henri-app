import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateScore, buildSignals } from "@/lib/scoring";
import type { Urgency } from "@/lib/scoring";
import { buildScoreSignalBreakdown } from "@/lib/scoring/signals";
import { logger } from "@/lib/logger";
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

/* ── Main cron handler ───────────────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    /* ── 1. Fetch unscored permits ──────────────────────────────────────── */

    // 2026-05-02 fix: reduced LIMIT from 5000 → 1000 because a 5000-row
    // SELECT that includes raw_json (jsonb, ~10KB per row average) was
    // pulling ~50MB and timing out the Supabase 60s statement budget
    // when the cron table was under heavy concurrent UPDATE pressure
    // from the parallel enrich + backfill ops:
    //   "Failed to fetch unscored permits: canceling statement due to
    //    statement timeout"
    // Per-run throughput is unchanged because the inner deadlineExceeded
    // guard already caps work at ~1000 permits per invocation. Smaller
    // SELECT = lower memory pressure on the planner + faster bitmap
    // heap scan via idx_permits_unscored.
    const { data: unscoredPermits, error: fetchError } = await supabase
      .from("permits")
      .select("id, permit_type, status, description, address, city, state, zip, latitude, longitude, estimated_value, issued_date, applied_date, applicant_name, created_at, raw_json")
      .is("scored_at", null)
      .limit(1000);

    if (fetchError) {
      throw new Error(`Failed to fetch unscored permits: ${fetchError.message}`);
    }

    if (!unscoredPermits || unscoredPermits.length === 0) {
      return NextResponse.json({
        success: true,
        summary: { scored: 0, leadsCreated: 0, assigned: 0, notified: 0 },
      });
    }

    const permits = unscoredPermits as PermitRow[];

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
     * scoring falls back to "no value" (signal=0). Honest: no fabricated
     * values ever flow into the scorer.
     *
     * Cap at 100k training rows to keep the cron query fast (~2s). */
    let valueModel: ValueModel | null = null;
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

    // ── Wave 2.A NRI lookup — county-level only (tract-level needs
    //    a tract_fips on every lead; we don't have that yet, so we
    //    join via state+county slug from the lead row). The ~3k NRI
    //    counties fit comfortably in memory.
    const nriByCounty = new Map<string, number>(); // key: "AL/Autauga" lowercased → risk_score
    try {
      const { data } = await supabase
        .from("risk_nri_county")
        .select("state_abbrv, county_name, risk_score")
        .not("risk_score", "is", null)
        .limit(5000);
      for (const r of data ?? []) {
        if (
          typeof r.state_abbrv === "string" &&
          typeof r.county_name === "string" &&
          typeof r.risk_score === "number"
        ) {
          nriByCounty.set(
            `${r.state_abbrv.toLowerCase()}/${r.county_name.toLowerCase()}`,
            r.risk_score,
          );
        }
      }
      logger.info("score.nri_loaded", { counties: nriByCounty.size });
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

    // Lien lookup — bucket by lowercased state prefix of the
    // CourtListener `court` slug (e.g. "calsup" → "ca", "txctapp" → "tx").
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
        if (typeof r.court !== "string" || r.court.length < 2) continue;
        const st = r.court.slice(0, 2).toLowerCase();
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

    /** Approximate miles between two lat/lng pairs via haversine. */
    function haversineMi(
      lat1: number,
      lng1: number,
      lat2: number,
      lng2: number,
    ): number {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

    /** NRI risk score for a permit's (state, city). NRI is keyed on
     *  county_name, not city, so this is a heuristic — many cities
     *  share their county name (e.g., "Sacramento" maps to Sacramento
     *  County). When no match, returns null and the booster stays 0. */
    function nriRiskScoreFor(state: string | null, city: string | null): number | null {
      if (!state || !city) return null;
      const k = `${state.toLowerCase()}/${city.toLowerCase()}`;
      const v = nriByCounty.get(k);
      return v != null ? v : null;
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
      const trade = (permit.permit_type ?? "").toLowerCase().trim();
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
        if (forecast && forecast.sample_size >= 20) {
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
          trade: (permit.raw_json as Record<string, string> | null)?.normalized_trade ?? permit.permit_type,
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

      const result = calculateScore(signals);
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

    for (const sl of scoredLeads) {
      // Audit priority #8: inline 280s deadline. The lead-build loop is
      // the heaviest part of the cron (rules engine + LLM mining +
      // signal-jsonb construction). Bail early so the orchestrator still
      // gets to write the leads it has prepared so far.
      if (deadlineExceeded()) {
        logger.warn("score cron deadline reached during lead build", {
          processedLeads: leadsToInsert.length,
          remainingScored: scoredLeads.length - leadsToInsert.length,
          elapsedMs: Date.now() - t0,
        });
        break;
      }
      const zip = sl.permit.zip;
      if (!zip) continue;
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
          status: "new",
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
          notes: sl.factors.length > 0
            ? `Scoring factors: ${sl.factors.join(" | ")}`
            : null,
        });

        assignmentMap.set(`${sl.permit.id}:${contractor.id}`, { scored: sl, contractor });
      }
      /* Skip permits in ZIPs with no contractors — they'll be picked up
         when a contractor claims that territory. */
    }

    let assignedCount = 0;
    let notifiedCount = 0;

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

      const { data: insertedLeads, error: insertError } = insertResult;
      if (insertError) {
        throw new Error(`Failed to insert leads: ${insertError.message}`);
      }

      assignedCount = insertedLeads?.length ?? 0;

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
                await sendLeadSMS(assignment.contractor.phone, {
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
                });
              } catch (e) {
                logger.error("SMS notification error", { error: String(e) });
              }
            }
          })
        ).catch((err) => logger.error("Hot lead SMS batch error", { error: String(err) }));
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
     */
    const permitIds = permits.map((p) => p.id);
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
    await logCronRun("score", t0, {
      pulled: scoredLeads.length,
      inserted: assignedCount,
      summary: responseBody,
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
