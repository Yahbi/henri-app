/**
 * GET/POST /api/cron/parcels-sidecar
 *
 * Fills `public.parcels_sidecar` from the `parcel_sources` registry
 * (migration 00085). Rotates across enabled sources most-overdue-first and
 * resumes each one from a per-source cursor, so a multi-million-row feed
 * walks forward across runs instead of re-reading page 1 forever.
 *
 *
 * WHY THIS ROUTE EXISTS
 * ---------------------
 * `parcel_sources` held 69 registered feeds and `parcels_sidecar` held ZERO
 * rows, because the only writer ever built was a Hetzner-hosted Python
 * loader (`scripts/_sidecar_loaders/load_parcels_arcgis.py`). Henri does not
 * run Hetzner — the external scheduler there went silent on 2026-05-14 and
 * every ingest path now lives in a Vercel cron route fired by
 * .github/workflows/cron-fleet.yml. So the loader was unreachable code and
 * the read side had nothing to read.
 *
 * The read side was already wired and waiting:
 * `src/lib/enrichment/parcels-sidecar.ts` is called from `enrichFromCounty`
 * in `county-gis.ts`, and `/api/cron/synthesize-pre-intent` queries the table
 * directly. Both start returning hits the moment rows land.
 *
 * That matters because contact completeness is the binding constraint on the
 * product: measured 2026-08-07 across 276,965 leads, owner_name is 45.0%
 * filled and phone 0.97%. `contact_completeness` is one of the six scoring
 * signals, so the gap also caps every score below the Hot threshold. Parcel
 * feeds carry owner names at scale.
 *
 *
 * WALL-CLOCK BUDGET
 * -----------------
 * The fleet calls every endpoint with `curl --max-time 290`. Overrunning it
 * returns HTTP 000, and TWO consecutive non-200s make the fleet abandon every
 * remaining endpoint in that slot — so one slow feed can cancel unrelated
 * ingest. Vercel additionally hard-kills the function at `maxDuration = 300`,
 * so 290 is already the ceiling and the budget is the only side with room to
 * move. The arithmetic that has to hold:
 *
 *     BUDGET_MS (160s) + SOURCE_DEADLINE_MS (75s) + bookkeeping tail (~5s)
 *       = 240s, i.e. 50s of headroom under the 290s curl ceiling.
 *
 * BUDGET_MS only decides when to stop STARTING a new source; the source
 * already running still has to finish, which is what SOURCE_DEADLINE_MS
 * bounds. Sources run sequentially (not in a concurrent batch) precisely so
 * that worst case stays a sum of two terms rather than an unbounded tail.
 * Changing either number without redoing this sum is how the ceiling gets
 * blown.
 *
 *
 * GRACEFUL DEGRADE
 * ----------------
 * A source that 404s, hangs, changes schema or fails to map takes a strike on
 * `error_count` and the run moves to the next source. Nothing a single
 * upstream can do aborts the run.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";
import { decideNextPage } from "@/lib/scrapers/arcgis";
import {
  dedupeParcelRows,
  groupRowsByShape,
  isParcelMappingFailure,
  mapParcelRow,
  resolveFieldMap,
  type ParcelSidecarRow,
} from "@/lib/parcels/field-map";
import {
  PARCELS_CRON_PATH,
  readParcelCursor,
  writeParcelCursor,
} from "@/lib/parcels/cursor";
import { buildArcgisQueryUrl, buildSocrataUrl } from "@/lib/parcels/endpoints";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Stop STARTING new sources after this. See the budget note in the header. */
const BUDGET_MS = 160_000;

/** Hard ceiling on one source's pass. See the budget note in the header. */
const SOURCE_DEADLINE_MS = 75_000;

/** Upstream page size. ArcGIS servers may cap lower; `decideNextPage` adopts theirs. */
const PAGE_SIZE = 1000;

/**
 * Write chunk size.
 *
 * Deliberately small. PostgREST inherits the database's `statement_timeout`
 * (8s here) and a wide upsert carrying `raw_json` is not cheap, so a large
 * batch risks timing out and losing the whole page. 200 also keeps each
 * request's body well clear of the REST body limit.
 */
const WRITE_CHUNK = 200;

/**
 * Rows one source may write per run, before the wall clock is even consulted.
 *
 * The registered feeds are enormous (WV-PARCEL-SUMMARY reports 1,394,081
 * rows, NC-ONEMAP-STATEWIDE 5,938,901) and each row stores its full upstream
 * record in `raw_json` — measured at 577 bytes/row for WV-PARCEL-SUMMARY and
 * 847 for WV-SITE-ADDRESSES. The database is already 11 GB (permits alone is
 * 6.2 GB) and has hit disk-full once before, so unbounded ingest is a real
 * operational hazard rather than a theoretical one. A bounded fill rate lets
 * an operator watch `pg_database_size` between runs and stop early.
 *
 * Parcel data refreshes quarterly upstream, so there is nothing to gain from
 * filling faster than the operator can supervise.
 */
const MAX_ROWS_PER_SOURCE_PER_RUN = 20_000;

interface ParcelSourceRow {
  source_key: string;
  state_code: string;
  jurisdiction: string | null;
  source_kind: string;
  endpoint_url: string;
  data_layer: string | null;
  field_map: Record<string, unknown> | null;
  notes: string | null;
  error_count: number | null;
  last_run_at: string | null;
}

type SourceOutcome =
  /** Rows were fetched and written. */
  | "ok"
  /** Endpoint answered cleanly with nothing left to read. */
  | "empty"
  /** Rows came back but none produced a parcel id — the field_map is wrong. */
  | "mapping_failed"
  /** Transport / HTTP / JSON failure, or an ArcGIS in-band error envelope. */
  | "fetch_failed"
  /** Every write failed. */
  | "write_failed"
  /** No loader handles this `source_kind`. */
  | "unsupported";

function isFailure(outcome: SourceOutcome): boolean {
  return outcome !== "ok" && outcome !== "empty";
}

interface SourceResult {
  source_key: string;
  state: string;
  kind: string;
  outcome: SourceOutcome;
  fetched: number;
  mapped: number;
  written: number;
  pages: number;
  startOffset: number;
  nextOffset: number;
  reachedEnd: boolean;
  /** Keys the payload actually shipped — the thing an operator needs to fix a mapping. */
  observedKeys: string[];
  detail: string | null;
  durationMs: number;
}

/** Reject if `p` has not settled within `ms`. Backstop for a hung socket. */
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`source deadline exceeded after ${ms}ms: ${label}`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

interface UpstreamPage {
  records: Record<string, unknown>[];
  /** ArcGIS only; undefined elsewhere. Feeds `decideNextPage`. */
  exceededTransferLimit?: boolean;
  /** Non-null on an in-band upstream error envelope. */
  error: string | null;
}

async function fetchPage(
  source: ParcelSourceRow,
  offset: number,
  pageSize: number,
): Promise<UpstreamPage> {
  const url =
    source.source_kind === "arcgis"
      ? buildArcgisQueryUrl(source.endpoint_url, offset, pageSize)
      : buildSocrataUrl(source.endpoint_url, offset, pageSize);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
      },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    return {
      records: [],
      error: `fetch: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    return { records: [], error: `HTTP ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      records: [],
      error: `json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ArcGIS reports failures IN BAND — HTTP 200 with an `error` object. A
  // status-code check alone reads that as an empty page and would advance the
  // cursor past data that was never read.
  const envelope = body as {
    error?: { message?: string; details?: string[] };
    features?: Array<{ attributes?: Record<string, unknown> }>;
    exceededTransferLimit?: boolean;
  };
  if (envelope?.error) {
    return {
      records: [],
      error: `upstream: ${envelope.error.message ?? "arcgis error envelope"}`,
    };
  }

  if (source.source_kind === "arcgis") {
    const records = (envelope.features ?? [])
      .map((f) => f.attributes)
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object");
    return { records, exceededTransferLimit: envelope.exceededTransferLimit, error: null };
  }

  if (Array.isArray(body)) {
    return { records: body as Record<string, unknown>[], error: null };
  }
  return { records: [], error: "unrecognised payload shape" };
}

/**
 * Write one page's rows.
 *
 * Deduped (a repeated conflict key aborts the whole statement), grouped by
 * shape (see `groupRowsByShape` — this is what stops the upsert nulling
 * columns a sparse row omitted), then chunked.
 */
async function writeRows(
  supabase: ReturnType<typeof createAdminClient>,
  rows: ParcelSidecarRow[],
  sourceKey: string,
): Promise<{ written: number; failedChunks: number; lastError: string | null }> {
  let written = 0;
  let failedChunks = 0;
  let lastError: string | null = null;

  for (const group of groupRowsByShape(dedupeParcelRows(rows))) {
    for (let i = 0; i < group.length; i += WRITE_CHUNK) {
      const chunk = group.slice(i, i + WRITE_CHUNK);
      const { error, count } = await supabase
        .from("parcels_sidecar")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parcels_sidecar predates the generated Database typedef (migration 00085).
        .upsert(chunk as any, {
          onConflict: "state_code,source_parcel_id",
          count: "exact",
        });
      if (error) {
        failedChunks += 1;
        lastError = error.message;
        logger.warn("parcels-sidecar.write_error", {
          source_key: sourceKey,
          chunk_size: chunk.length,
          error: error.message,
        });
        continue;
      }
      written += count ?? chunk.length;
    }
  }
  return { written, failedChunks, lastError };
}

/**
 * Walk one source from its cursor until the row cap, the soft deadline or the
 * end of the feed.
 *
 * `deadlineAt` is the SOFT stop: the loop checks it between pages so it can
 * exit cleanly with a cursor worth persisting. `withDeadline` around the call
 * site is the HARD backstop for a socket that never settles.
 */
async function ingestSource(
  source: ParcelSourceRow,
  startOffset: number,
  deadlineAt: number,
  maxRows: number,
): Promise<Omit<SourceResult, "source_key" | "state" | "kind" | "durationMs">> {
  const base = {
    fetched: 0,
    mapped: 0,
    written: 0,
    pages: 0,
    startOffset,
    nextOffset: startOffset,
    reachedEnd: false,
    observedKeys: [] as string[],
  };

  if (source.source_kind !== "arcgis" && source.source_kind !== "socrata") {
    // `csv` (AZ Maricopa bulk download, FL DOR FTP) and `scrape` need a
    // different transport entirely; both registry rows are disabled.
    return {
      ...base,
      outcome: "unsupported",
      detail: `no loader for source_kind '${source.source_kind}'`,
    };
  }

  const resolved = resolveFieldMap(source.field_map);
  if (!resolved.has("source_parcel_id")) {
    // `source_parcel_id` is NOT NULL and is half the dedup key, so without it
    // not one row is writable. Fail loudly instead of returning a zero that
    // looks like a quiet feed.
    return {
      ...base,
      outcome: "mapping_failed",
      detail:
        "field_map resolves no source_parcel_id — every row would be unwritable",
    };
  }

  const supabase = createAdminClient();
  let offset = startOffset;
  let pageSize = PAGE_SIZE;
  let writeFailures = 0;
  let lastWriteError: string | null = null;

  for (;;) {
    if (Date.now() > deadlineAt) break;
    if (base.fetched >= maxRows) break;

    const page = await fetchPage(source, offset, pageSize);
    if (page.error) {
      // Nothing was read, so the cursor must NOT advance past this offset.
      return {
        ...base,
        outcome: "fetch_failed",
        detail: `${page.error} (offset ${offset})`,
      };
    }

    if (base.observedKeys.length === 0 && page.records[0]) {
      base.observedKeys = Object.keys(page.records[0]).sort().slice(0, 40);
    }

    const decision = decideNextPage(
      page.records.length,
      pageSize,
      page.exceededTransferLimit,
    );

    if (page.records.length > 0) {
      const rows = page.records
        .map((upstream) =>
          mapParcelRow({
            sourceKey: source.source_key,
            stateCode: source.state_code,
            resolved,
            upstream,
          }),
        )
        .filter((r): r is ParcelSidecarRow => r !== null);

      base.fetched += page.records.length;
      base.mapped += rows.length;

      // A whole page of rows that yielded no parcel id means the configured
      // id column does not exist in this payload. Stop rather than paging
      // through millions of unwritable rows.
      if (isParcelMappingFailure(page.records.length, rows.length)) {
        return {
          ...base,
          outcome: "mapping_failed",
          detail: `${page.records.length} rows produced no source_parcel_id`,
        };
      }

      const w = await writeRows(supabase, rows, source.source_key);
      base.written += w.written;
      writeFailures += w.failedChunks;
      if (w.lastError) lastWriteError = w.lastError;
    }

    base.pages += 1;
    offset += page.records.length;
    base.nextOffset = offset;
    pageSize = decision.pageSize;

    if (!decision.next) {
      base.reachedEnd = decision.reachedEnd;
      break;
    }
  }

  // End of feed -> clear the cursor so the next turn wraps to the start and
  // picks up upstream's quarterly refresh.
  if (base.reachedEnd) base.nextOffset = 0;

  if (base.fetched === 0) {
    return { ...base, outcome: "empty", detail: null };
  }
  if (base.written === 0 && writeFailures > 0) {
    return {
      ...base,
      outcome: "write_failed",
      detail: lastWriteError ?? "every chunk failed",
    };
  }
  return {
    ...base,
    outcome: "ok",
    detail: writeFailures > 0 ? `${writeFailures} chunk(s) failed: ${lastWriteError}` : null,
  };
}

async function runParcelsSidecar(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const trigger = detectTrigger(request);
  const supabase = createAdminClient();
  const params = request.nextUrl.searchParams;

  // Targeted mode — verify one source, or backfill it deliberately, without
  // waiting for the rotation to reach it.
  const requestedKeys = (params.get("source_key") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const maxRowsOverride = Number(params.get("max_rows"));
  const maxRows =
    Number.isFinite(maxRowsOverride) && maxRowsOverride > 0
      ? Math.min(maxRowsOverride, 200_000)
      : MAX_ROWS_PER_SOURCE_PER_RUN;

  // Manual offset override, targeted mode only — a global override would
  // stomp every enabled source's cursor at once.
  const offsetRaw = params.get("offset");
  const explicitOffset =
    requestedKeys.length > 0 && offsetRaw != null
      ? Math.max(0, Number(offsetRaw) || 0)
      : null;

  const columns =
    "source_key, state_code, jurisdiction, source_kind, endpoint_url, data_layer, field_map, notes, error_count, last_run_at";

  // Most-overdue first, so the rotation drains fairly and a newly enabled
  // source (last_run_at IS NULL) gets its first turn before an old source
  // gets a repeat.
  let query = supabase
    .from("parcel_sources")
    .select(columns)
    .order("last_run_at", { ascending: true, nullsFirst: true });
  query = requestedKeys.length > 0
    ? query.in("source_key", requestedKeys)
    : query.eq("enabled", true);

  const { data: sources, error: sourcesErr } = await query.returns<ParcelSourceRow[]>();

  if (sourcesErr) {
    logger.error("parcels-sidecar.sources_query_failed", { error: sourcesErr.message });
    await logCronRun(PARCELS_CRON_PATH, startedAt, {
      status: "error",
      error: `sources query failed: ${sourcesErr.message}`,
      trigger,
    });
    return NextResponse.json(
      { error: "sources query failed", detail: sourcesErr.message },
      { status: 500 },
    );
  }

  if (!sources || sources.length === 0) {
    const body = {
      ok: true,
      note:
        requestedKeys.length > 0
          ? "no parcel_sources matched the requested source_key(s)"
          : "no enabled rows in parcel_sources",
      results: [] as SourceResult[],
    };
    // Logged on the empty path too: "never fired" and "fired, found nothing"
    // must not look the same in cron_runs.
    await logCronRun(PARCELS_CRON_PATH, startedAt, {
      pulled: 0,
      inserted: 0,
      summary: body,
      trigger,
    });
    return NextResponse.json(body);
  }

  const results: SourceResult[] = [];
  let budgetExhausted = false;

  for (const source of sources) {
    if (Date.now() - startedAt > BUDGET_MS) {
      budgetExhausted = true;
      logger.warn("parcels-sidecar.budget_exhausted", {
        processed: results.length,
        remaining: sources.length - results.length,
      });
      break;
    }

    const sourceStart = Date.now();
    const startOffset = explicitOffset ?? readParcelCursor(source.notes);
    // The soft deadline is whichever comes first: this source's own ceiling,
    // or what is left of the run's total budget.
    const deadlineAt = Math.min(
      sourceStart + SOURCE_DEADLINE_MS,
      startedAt + BUDGET_MS + SOURCE_DEADLINE_MS,
    );

    let outcome: Omit<SourceResult, "source_key" | "state" | "kind" | "durationMs">;
    try {
      outcome = await withDeadline(
        ingestSource(source, startOffset, deadlineAt, maxRows),
        SOURCE_DEADLINE_MS,
        source.source_key,
      );
    } catch (err) {
      // Catch-all: one broken source must never abort the run.
      const message = err instanceof Error ? err.message : String(err);
      logger.error("parcels-sidecar.source_threw", {
        source_key: source.source_key,
        error: message,
      });
      outcome = {
        outcome: "fetch_failed",
        fetched: 0,
        mapped: 0,
        written: 0,
        pages: 0,
        startOffset,
        nextOffset: startOffset,
        reachedEnd: false,
        observedKeys: [],
        detail: message,
      };
    }

    const failed = isFailure(outcome.outcome);

    // Bookkeeping. `error_count` climbs on failure and resets on a healthy
    // run, so a chronically broken feed is visible without reading logs.
    // The cursor only advances on a healthy run, and never from a manual
    // ?offset= backfill — that must not move the rotation's position.
    const nextNotes =
      failed || explicitOffset !== null
        ? source.notes
        : writeParcelCursor(source.notes, outcome.nextOffset);

    const { error: stampErr } = await supabase
      .from("parcel_sources")
      .update({
        last_run_at: new Date().toISOString(),
        last_count: outcome.written,
        error_count: failed ? (source.error_count ?? 0) + 1 : 0,
        notes: nextNotes,
      })
      .eq("source_key", source.source_key);
    if (stampErr) {
      logger.warn("parcels-sidecar.stamp_failed", {
        source_key: source.source_key,
        error: stampErr.message,
      });
    }

    if (failed) {
      logger.warn("parcels-sidecar.source_failed", {
        source_key: source.source_key,
        outcome: outcome.outcome,
        detail: outcome.detail,
        observedKeys: outcome.observedKeys.slice(0, 12),
      });
    }

    results.push({
      source_key: source.source_key,
      state: source.state_code,
      kind: source.source_kind,
      durationMs: Date.now() - sourceStart,
      ...outcome,
    });
  }

  const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
  const totalWritten = results.reduce((s, r) => s + r.written, 0);
  const outcomeCounts: Record<string, number> = {};
  for (const r of results) {
    outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] ?? 0) + 1;
  }

  const summary = {
    sourcesProcessed: results.length,
    sourcesAvailable: sources.length,
    totalFetched,
    totalWritten,
    budgetExhausted,
    outcomeCounts,
    // The number to watch across runs. 0 written with >0 fetched means the
    // mappings resolve but nothing is landing.
    resumed: results.filter((r) => r.startOffset > 0).length,
  };

  const failedCount = results.filter((r) => isFailure(r.outcome)).length;

  logger.info("parcels-sidecar.done", {
    duration_ms: Date.now() - startedAt,
    ...summary,
  });

  await logCronRun(PARCELS_CRON_PATH, startedAt, {
    pulled: totalFetched,
    inserted: totalWritten,
    summary: { ...summary, results },
    trigger,
    status: failedCount > 0 && failedCount === results.length ? "partial" : "ok",
  });

  return NextResponse.json({
    success: true,
    duration_ms: Date.now() - startedAt,
    summary,
    results,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Guarantees an audit row even when the run dies.
 *
 * `runParcelsSidecar` writes its cron_runs row on the happy path; every other
 * exit — an unhandled throw, or Vercel killing the function at the 300s wall
 * — would otherwise leave no trace, making "never fired" and "failed
 * silently" indistinguishable. Several sidecar crons log only on success and
 * that ambiguity is exactly what hid their failures.
 *
 * The catch records, then returns 500 so the fleet's non-200 check still
 * marks the workflow run failed.
 */
async function handler(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    return await runParcelsSidecar(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("parcels-sidecar.unhandled", { error: message });
    await logCronRun(PARCELS_CRON_PATH, startedAt, {
      status: "error",
      error: message,
      trigger: detectTrigger(request),
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
