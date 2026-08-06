/**
 * GET /api/cron/activate-arcgis-sources
 *
 * Daily cron — probes up to 50 disabled ArcGIS endpoints and enables the ones
 * that prove they serve permit data. Each activation makes the endpoint
 * visible to Henri's `/api/cron/scrape` (the permit ingest job).
 *
 * Why incremental: a one-shot enable-all would suddenly add thousands of
 * sources to the daily scrape pool, blowing through API quotas / Vercel
 * function-time.
 *
 * THE PROBE GATE (2026-08-04)
 * ---------------------------
 * This route used to flip `enabled=true` on 50 rows WITHOUT ever looking at
 * what the endpoint serves. That is how ~2,642 enabled sources ended up
 * pointing at business-licence registries, sewer-wye inventories, wetland
 * layers and building footprints: they scrape cleanly, their rows land in
 * `public.permits`, and they inflate the permit count the marketing site
 * reports — a truthfulness problem, not just noise.
 *
 * Now every candidate is fetched once (one row, 8s timeout) and classified by
 * `looksLikeNonPermitDataset()` — the same single heuristic the scrapers use.
 * Three outcomes, none of them silent:
 *
 *   permit       -> enabled, stamped `dataset_kind='permit'`
 *   non_permit   -> stays disabled, stamped `dataset_kind='non_permit'` with
 *                   the disqualifying column, plus the standard
 *                   `[henri:scrape-diagnostic]` block in `notes`. The
 *                   candidate query excludes that kind, so it is decided ONCE
 *                   rather than re-probed every day forever.
 *   unreachable  -> stays disabled, takes one strike via `recordSourceRun`.
 *                   Bounded retry: the candidate query drops rows at
 *                   MAX_CONSECUTIVE_ERRORS, so a dead stub cannot be retried
 *                   forever either.
 *
 * The `dataset_kind` columns come from migration 00122. Per CLAUDE.md's
 * feature-flag rule the read AND write paths degrade gracefully when that
 * migration has not been applied — the notes diagnostic and the strike counter
 * still record every refusal, only the queryable classification is missing.
 *
 * Order: wedge cities first (NC/SC/TN/VA), then everything else. Within each
 * group, fewest strikes first so a candidate that has failed a probe before
 * never blocks a fresh one, then jurisdiction-alphabetical for determinism.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";
import {
  MAX_CONSECUTIVE_ERRORS,
  NON_PERMIT_KIND,
  activateProbedSources,
  datasetKindSupported,
  isUndefinedColumnError,
  recordSourceRun,
  rejectProbedSource,
  setDatasetKindSupported,
} from "@/lib/scrapers/sources-db";
import { probeArcGISDataset, type DatasetProbe } from "./probe";

export const runtime = "nodejs";
/**
 * 300s, up from 60s: the run now makes up to 50 network probes. At
 * PROBE_CONCURRENCY=8 and an 8s timeout the worst case is ~50s of probing plus
 * the DB writes, which does not fit a 60s ceiling.
 */
export const maxDuration = 300;

const BATCH_PER_RUN = 50;
const PROBE_CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 8_000;
/**
 * Stop LAUNCHING new probes here so the run always returns a clean summary.
 *
 * 50 candidates at concurrency 8 x 8s is ~50s of probing in the worst case;
 * the remaining ~180s of the 300s ceiling is for the per-refusal writes, which
 * are sequential and run against an instance that is not always healthy.
 * /api/cron/catchup fires this route with a 120s client timeout — overshooting
 * that only costs a retry (the route still completes server-side), but the
 * budget is set so a normal run finishes well inside it.
 */
const PROBE_BUDGET_MS = 120_000;

/** Wedge-city state codes prioritized first. The wedge bullet says
 *  these are the markets where Henri needs to crush. */
const WEDGE_STATES = ["NC", "SC", "TN", "VA"] as const;

interface Candidate {
  source_key: string;
  endpoint: string;
  notes: string | null;
}

type CandidateResponse = {
  data: Candidate[] | null;
  error: { code?: string | null; message: string } | null;
};

/**
 * Load activation candidates, excluding rows a previous probe already
 * disqualified and rows that have burned through their strike budget.
 *
 * Retries without the `dataset_kind` filter when migration 00122 is absent —
 * an unknown column fails the WHOLE query, so it cannot just be added blind.
 */
async function fetchCandidates(
  supabase: ReturnType<typeof createAdminClient>,
  opts: { wedge: boolean; limit: number },
): Promise<Candidate[]> {
  const run = async (useDatasetKind: boolean): Promise<CandidateResponse> => {
    let q = supabase
      .from("permit_sources")
      .select("source_key, endpoint, notes")
      .eq("enabled", false)
      .eq("source_type", "arcgis")
      .lt("error_count", MAX_CONSECUTIVE_ERRORS);
    q = opts.wedge
      ? q.in("state", WEDGE_STATES as unknown as string[])
      : q.not("state", "in", `(${WEDGE_STATES.map((s) => `"${s}"`).join(",")})`);
    if (useDatasetKind) q = q.neq("dataset_kind", NON_PERMIT_KIND);
    return (await q
      .order("error_count", { ascending: true })
      .order("jurisdiction", { ascending: true })
      .limit(opts.limit)) as unknown as CandidateResponse;
  };

  const attempt = datasetKindSupported() !== false;
  let res = await run(attempt);
  if (attempt && res.error && isUndefinedColumnError(res.error)) {
    setDatasetKindSupported(false);
    res = await run(false);
  } else if (attempt && !res.error) {
    setDatasetKindSupported(true);
  }

  if (res.error) {
    logger.error("activate-arcgis.candidates_failed", {
      error: res.error.message,
      wedge: opts.wedge,
    });
    return [];
  }

  return (res.data ?? []).filter(
    (r): r is Candidate =>
      typeof r?.source_key === "string" &&
      r.source_key.length > 0 &&
      typeof r?.endpoint === "string" &&
      r.endpoint.trim().length > 0,
  );
}

/** Probe candidates with bounded concurrency, stopping at the time budget. */
async function probeAll(
  candidates: Candidate[],
  deadline: number,
): Promise<Array<{ candidate: Candidate; probe: DatasetProbe }>> {
  const out: Array<{ candidate: Candidate; probe: DatasetProbe }> = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < candidates.length) {
      if (Date.now() > deadline) return;
      const candidate = candidates[cursor++];
      out.push({
        candidate,
        probe: await probeArcGISDataset(candidate.endpoint, PROBE_TIMEOUT_MS),
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, candidates.length) }, worker),
  );
  return out;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  try {
    // Step 1 — wedge-state candidates first, then fill from anywhere else.
    const wedge = await fetchCandidates(supabase, { wedge: true, limit: BATCH_PER_RUN });
    const remaining = BATCH_PER_RUN - wedge.length;
    const other =
      remaining > 0
        ? await fetchCandidates(supabase, { wedge: false, limit: remaining })
        : [];
    const candidates = [...wedge, ...other];

    if (candidates.length === 0) {
      const result = {
        ok: true,
        duration_ms: Date.now() - startedAt,
        activated: 0,
        note:
          "No ArcGIS sources left to activate — all are enabled, already " +
          "classified non-permit, or out of probe retries.",
      };
      await logCronRun("activate-arcgis-sources", startedAt, {
        pulled: 0, inserted: 0, summary: result, trigger: detectTrigger(request),
      });
      return NextResponse.json(result);
    }

    // Step 2 — probe before enabling. This is the whole point of the route.
    const probed = await probeAll(candidates, startedAt + PROBE_BUDGET_MS);

    const passed = probed.filter((r) => r.probe.verdict === "permit");
    const rejected = probed.filter((r) => r.probe.verdict === "non_permit");
    const unreachable = probed.filter((r) => r.probe.verdict === "unreachable");

    // Step 3 — enable only what passed.
    const activated = await activateProbedSources(
      passed.map((r) => r.candidate.source_key),
    );

    // Step 4 — record every refusal WITH its evidence. Sequential: this runs
    // against an instance that is not always healthy, and 50 parallel writes
    // to one table buys nothing on a daily cron.
    for (const r of rejected) {
      await rejectProbedSource(r.candidate.source_key, {
        reason: r.probe.reason ?? "activation probe rejected the payload",
        observedKeys: r.probe.observedKeys,
        notes: r.candidate.notes,
      });
    }

    for (const r of unreachable) {
      // Reuses the scrape strike counter on purpose: "this endpoint is
      // broken" is the same signal whether a probe or a scrape found it, and
      // it is what bounds the retry. `recordSourceRun` never enables a source.
      await recordSourceRun(r.candidate.source_key, {
        outcome: "fetch_failed",
        rowCount: 0,
        detail: r.probe.reason ?? "activation probe failed",
        observedKeys: r.probe.observedKeys,
        notes: r.candidate.notes,
        configured: { activation_probe: "arcgis" },
      });
    }

    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      candidates: candidates.length,
      probed: probed.length,
      /** Candidates the time budget cut off. They keep their state and lead the next run. */
      skipped_budget: candidates.length - probed.length,
      activated,
      rejected_non_permit: rejected.length,
      unreachable: unreachable.length,
      wedge_candidates: wedge.length,
      other_candidates: other.length,
      /** False when migration 00122 is not applied — refusals then live only in `notes`. */
      dataset_kind_column: datasetKindSupported() !== false,
    };

    logger.info("activate-arcgis.done", result);
    // `partial` means INCONCLUSIVE, not "activated nothing".
    //
    // The previous rule was `probed > 0 && activated === 0`, which reported a
    // run as unclean whenever every candidate was rejected — but a definitive
    // rejection is this route working exactly as designed. Most of the ~2,364
    // auto-discovered ArcGIS endpoints in the registry are not permit feeds,
    // and a batch of 50 that are all correctly refused and recorded with their
    // evidence is a CLEAN run, not a failure. Reporting it as one is how a
    // fleet-wide failure count fills with entries nobody can act on.
    //
    // What genuinely leaves work undone is a probe that returned no verdict:
    // an endpoint we could not reach, or a candidate the time budget cut off
    // before it was probed at all. Those are the ones worth surfacing.
    const inconclusive = unreachable.length + (candidates.length - probed.length);
    await logCronRun("activate-arcgis-sources", startedAt, {
      pulled: probed.length,
      inserted: activated,
      summary: result,
      trigger: detectTrigger(request),
      status: inconclusive > 0 ? "partial" : "ok",
      error:
        inconclusive > 0
          ? `${unreachable.length} unreachable, ${candidates.length - probed.length} cut off by the probe budget`
          : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("activate-arcgis.error", { error: String(err) });
    await logCronRun("activate-arcgis-sources", startedAt, {
      error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "activate-arcgis-sources failed", detail: String(err) },
      { status: 500 },
    );
  }
}
