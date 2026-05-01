import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateScore, buildSignals } from "@/lib/scoring";
import type { Urgency } from "@/lib/scoring";
import { buildScoreSignalBreakdown } from "@/lib/scoring/signals";
import { logger } from "@/lib/logger";
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

    // Batch sized to "as many as fit in 280s" — the deadlineExceeded()
    // guard inside the per-permit loops below is the actual hard stop.
    // Audit 2026-04-30 found 820k unscored permits backed up against a
    // 500-row daily batch; that's a 4.5-year clearance lag. Bumping the
    // SELECT cap to 5000 lets a single run process whatever fits in the
    // 280s budget. Vercel Hobby plan only permits daily cron so we lift
    // throughput per-run rather than running more often. If the deadline
    // is consistently hit, dial up further; if 5000 is rarely reached,
    // current backlog is shrinking and the cap is harmless.
    const { data: unscoredPermits, error: fetchError } = await supabase
      .from("permits")
      .select("id, permit_type, status, description, address, city, state, zip, latitude, longitude, estimated_value, issued_date, applied_date, applicant_name, created_at, raw_json")
      .is("scored_at", null)
      .limit(5000);

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

    const { data: territoryRows } = await supabase
      .from("territories")
      .select("zip, contractor_id, profiles!inner(id, phone, email, full_name)")
      .in("zip", leadZips)
      .eq("status", "active");

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

    const permitIds = permits.map((p) => p.id);
    await supabase
      .from("permits")
      .update({ scored_at: new Date().toISOString() })
      .in("id", permitIds);

    return NextResponse.json({
      success: true,
      summary: {
        scored: scoredLeads.length,
        leadsCreated: assignedCount,
        assigned: assignedCount,
        notified: notifiedCount,
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
    });
  } catch (err) {
    logger.error("Lead scoring cron error", { error: String(err) });
    return NextResponse.json(
      { error: "Lead scoring failed" },
      { status: 500 }
    );
  }
}
