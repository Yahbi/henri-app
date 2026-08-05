import { NextRequest, NextResponse } from "next/server";
import { scrapeSocrataSource } from "@/lib/scrapers/socrata";
import { scrapeArcGISSource } from "@/lib/scrapers/arcgis";
import { scrapeCkanSource } from "@/lib/scrapers/ckan";
import {
  getActiveSources,
  getSourcesByKeys,
  recordSourceRun,
  markSourceError,
  type DBPermitSource,
} from "@/lib/scrapers/sources-db";
import {
  resolveScraperKind,
  unsupportedDetail,
  type ScraperKind,
} from "@/lib/scrapers/dispatch";
import {
  emptyReport,
  isFailureOutcome,
  type ScrapeReport,
} from "@/lib/scrapers/types";
import { SCRAPE_CRON_PATH } from "@/lib/scrapers/cursor";
import { PERMIT_SOURCES } from "@/lib/scrapers/sources"; // fallback hardcoded sources
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET/POST /api/cron/scrape
 *
 * Scrapes enabled permit sources from the `permit_sources` DB table.
 * Falls back to the 6 hardcoded PERMIT_SOURCES if DB is empty.
 * Runs in batches of 5 concurrent sources to avoid rate limits.
 *
 * 2026-08-04 — five confirmed blockers closed here and in src/lib/scrapers/*:
 *
 *  1. DEAD AUTO-DISABLE. The route called `markSourceScraped()` (which reset
 *     `error_count` to 0 unconditionally) on every non-throwing run, and the
 *     scrapers never threw. `markSourceError()` was unreachable, so the
 *     10-strike auto-disable never fired and ~12k dead stubs were immortal.
 *     Now every source run returns a `ScrapeReport` with an explicit outcome
 *     and the route routes failures to `recordSourceRun()`.
 *
 *  2. WRONG MAPPINGS LOOKED LIKE SUCCESS. `{fetched:N, inserted:0}` was
 *     recorded identically to a genuinely quiet city. Scrapers now report
 *     `mapping_failed` with the keys the payload actually contained, which
 *     get persisted onto the source for the operator.
 *
 *  3. NO CURSOR. Every run restarted at offset 0, capping each source at
 *     20k rows FOREVER. A per-source cursor now persists between runs.
 *
 *  4. ARCGIS PAGINATION. Fixed in the scraper (see arcgis.ts header).
 *
 *  5. CKAN MIS-DISPATCH. `ckan` sources were fed to the Socrata scraper and
 *     silently produced nothing. Routing now goes through ./dispatch and a
 *     real CKAN datastore_search scraper exists.
 */

interface SourceResult {
  source: string;
  source_key: string;
  type: string;
  scraper: ScraperKind;
  outcome: string;
  fetched: number;
  mapped: number;
  inserted: number;
  updated: number;
  errors: number;
  nextOffset: number;
  detail: string | null;
  /**
   * Rows WRITTEN by the freshness pass specifically, split out from the
   * backfill, so the summary can answer "is the head lane doing any work?"
   *
   * Written, not inserted, and the distinction is not pedantic: the scrapers
   * cannot tell an insert from an update. `.upsert()` through PostgREST
   * returns the affected rows with no flag for which branch each took, so
   * socrata.ts:296 hardcodes `inserted: 0` and counts everything as
   * `updated`. Any field here named "inserted" would therefore report a
   * constant 0 and mean nothing — a metric that cannot vary is worse than no
   * metric, because it reads as a finding.
   *
   * For the count of genuinely-new permits, measure the table, not the
   * scraper: `count(*) FROM permits WHERE created_at > <run start>`. That is
   * how the 2026-08-05 fix was verified (12,999 new rows on the old code vs
   * 58,427 on the new one, same 230s budget). Wiring that number in here
   * wants a BRIN index on permits.created_at first — the column is unindexed
   * today, so the query seq-scans 2.26M rows and would risk the 8s PostgREST
   * statement timeout inside the cron itself.
   */
  headWritten: number;
}

/** Field mapping echoed into the diagnostic so an operator can diff it. */
function configuredMapping(source: DBPermitSource): Record<string, string | null> {
  return {
    id_field: source.idField,
    address_field: source.addressField,
    date_field: source.dateField,
    type_field: source.typeField,
    status_field: source.statusField,
    value_field: source.valueField,
    // Which of the above were GUESSED because permit_sources had no mapping.
    // 236,602 of 239,883 enabled sources have address_field IS NULL, so this
    // is usually the real reason a "mapping failure" happened.
    guessed_fields: source.unmappedFields.length
      ? source.unmappedFields.join("+")
      : "none",
    endpoint: source.endpoint,
  };
}

async function runOneSource(
  source: DBPermitSource,
  startOffset: number,
  maxPages?: number,
): Promise<{ report: ScrapeReport; scraper: ScraperKind }> {
  const scraper = resolveScraperKind(source.source_type, source.endpoint);

  if (scraper === "arcgis") {
    return {
      scraper,
      report: await scrapeArcGISSource(
        {
          source_key: source.source_key,
          city: source.city,
          state: source.state,
          endpoint: source.endpoint,
          id_field: source.idField,
          type_field: source.typeField,
          status_field: source.statusField,
          desc_field: source.descField,
          address_field: source.addressField,
          date_field: source.dateField,
          value_field: source.valueField,
        },
        { startOffset, maxPages },
      ),
    };
  }

  if (scraper === "ckan") {
    return { scraper, report: await scrapeCkanSource(source, { startOffset, maxPages }) };
  }

  if (scraper === "socrata") {
    return { scraper, report: await scrapeSocrataSource(source, { startOffset, maxPages }) };
  }

  // BLOCKER 5 (general case): fail LOUDLY rather than mis-dispatching into the
  // Socrata scraper, which used to return a silent, indistinguishable zero.
  return {
    scraper,
    report: emptyReport({
      outcome: "unsupported",
      detail: unsupportedDetail(source.source_type, source.endpoint),
      nextOffset: startOffset,
      reachedEnd: false,
    }),
  };
}

async function runScrape(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const trigger = detectTrigger(request);

  const results: SourceResult[] = [];

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  let totalFetched = 0;
  const outcomeCounts: Record<string, number> = {};

  // Load sources from DB first; fall back to hardcoded if DB is empty.
  //
  // TARGETED MODE (?source_key=a,b,c) — added 2026-08-05.
  // Without this there was no way to exercise a specific feed: the route only
  // ever scraped whatever getActiveSources() happened to return, and that
  // function splits each run 60/40 between proven producers and ~12k
  // never-produced explorer stubs. A newly-registered high-value source could
  // therefore sit unscraped for many runs, and a wrong field mapping was
  // impossible to test — you registered it and hoped. Targeted mode makes the
  // registry verifiable: register a source, scrape it by key, see the count.
  const requestedKeys = (request.nextUrl.searchParams.get("source_key") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  // Manual offset override, targeted mode only — a global override would
  // stomp the cursors of all 50 sources in a rotation run.
  const explicitOffsetRaw = request.nextUrl.searchParams.get("offset");
  const explicitOffset =
    requestedKeys.length > 0 && explicitOffsetRaw != null
      ? Math.max(0, Number(explicitOffsetRaw) || 0)
      : null;

  const dbSources = requestedKeys.length > 0
    ? await getSourcesByKeys(requestedKeys)
    : await getActiveSources(50);
  const useDbSources = dbSources.length > 0;

  if (requestedKeys.length > 0 && dbSources.length === 0) {
    return NextResponse.json(
      { error: "no matching enabled sources", requested: requestedKeys },
      { status: 404 },
    );
  }

  // Time budget (2026-06-10): high-volume sources (20k rows each) can push
  // a 50-source run past Vercel's 300s wall — the function then gets
  // hard-killed mid-batch and the cron reports HTTP 000 even though the
  // completed sources persisted. Stop launching NEW batches at 230s so the
  // run always returns a clean summary; unprocessed sources keep their
  // old last_scraped_at and lead the next hourly rotation.
  const startMs = Date.now();
  const BUDGET_MS = 230_000;
  let budgetExhausted = false;

  // ── FRESHNESS PASS vs BACKFILL (2026-08-05) ───────────────────────────
  // Measured before this change (20:04 UTC run): 191,775 rows fetched,
  // 186,704 updated, **0 inserted**, 10 sources processed, budget exhausted.
  // Every run spent its full 230s re-upserting permits we already had.
  //
  // The cause is the interaction of two individually-reasonable decisions.
  // The resume cursor walks each feed from the newest row backwards through
  // history, and each source was allowed 20 pages x 1,000 rows per run. So a
  // source with 1M rows of history needed 50+ consecutive runs of backfill
  // before the cursor wrapped and the newest page came up again — and until
  // it did, a permit issued today was unreachable. The 20k/source cap also
  // meant only ~10 of ~239k enabled sources were touched per run.
  //
  // Splitting the budget fixes both. Every source in the rotation now reads
  // its newest HEAD_PAGES first (offset 0 = newest, which is what the DESC
  // ordering in the Socrata and ArcGIS scrapers guarantees), so new permits
  // land on EVERY run regardless of how much history is left to backfill.
  // Backfill continues from the cursor with the smaller remaining allowance,
  // which also lets each run cover ~2.5x more sources.
  //
  // Backfill is deliberately the side that gave up pages: permit_freshness is
  // the heaviest scoring signal, so a permit from 2019 is worth far less to a
  // contractor than one from this morning. History still fills in, just at a
  // rate that no longer starves the thing customers actually pay for.
  const HEAD_PAGES = 2;
  const BACKFILL_PAGES = 6;

  if (useDbSources) {
    // Process DB sources in batches of 5 concurrent
    const BATCH = 5;
    for (let i = 0; i < dbSources.length; i += BATCH) {
      if (Date.now() - startMs > BUDGET_MS) {
        budgetExhausted = true;
        logger.warn("scrape.time_budget_exhausted", {
          processed: results.length,
          remaining: dbSources.length - i,
        });
        break;
      }
      const batch = dbSources.slice(i, i + BATCH);

      await Promise.allSettled(
        batch.map(async (source) => {
          // BLOCKER 3: resume where the last run stopped instead of
          // restarting at 0 and re-reading the same newest 20k rows forever.
          const startOffset = explicitOffset ?? source.cursorOffset;
          try {
            // Freshness pass — only meaningful when the cursor has already
            // moved off the newest page. At offset 0 the backfill call below
            // IS the newest page, so a head pass would just fetch it twice.
            // Skipped entirely for manual ?offset= backfills, which exist
            // precisely to read one specific slice of history.
            let headInserted = 0;
            let headUpdated = 0;
            let headFetched = 0;
            if (explicitOffset === null && startOffset > 0) {
              try {
                const head = await runOneSource(source, 0, HEAD_PAGES);
                headInserted = head.report.inserted;
                headUpdated = head.report.updated;
                headFetched = head.report.fetched;
              } catch (err) {
                // A head-pass failure must not cost this source its backfill;
                // the backfill call below has its own error handling.
                logger.warn("scrape.head_pass_failed", {
                  source_key: source.source_key,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }

            const { report, scraper } = await runOneSource(
              source,
              startOffset,
              BACKFILL_PAGES,
            );

            await recordSourceRun(source.source_key, {
              outcome: report.outcome,
              // Head rows count toward the source's health metric — they are
              // real rows this source produced this run, and excluding them
              // would make a source that is delivering fresh permits look
              // less productive than one only replaying history.
              rowCount: report.inserted + report.updated + headInserted + headUpdated,
              fetched: report.fetched + headFetched,
              mapped: report.mapped,
              usable: report.usable,
              observedKeys: report.observedKeys,
              detail: report.detail,
              configured: configuredMapping(source),
              notes: source.notes,
              // Only advance the cursor when the run was healthy, and never
              // from a manual ?offset= backfill — that must not move the
              // scheduled rotation's position in the feed.
              nextOffset:
                isFailureOutcome(report.outcome) || explicitOffset !== null
                  ? null
                  : report.nextOffset,
            });

            totalInserted += report.inserted + headInserted;
            totalUpdated += report.updated + headUpdated;
            totalErrors += report.errors;
            totalFetched += report.fetched + headFetched;
            outcomeCounts[report.outcome] = (outcomeCounts[report.outcome] ?? 0) + 1;

            if (isFailureOutcome(report.outcome)) {
              logger.warn("scrape.source_failed", {
                source_key: source.source_key,
                outcome: report.outcome,
                detail: report.detail,
                observedKeys: report.observedKeys.slice(0, 12),
              });
            }

            results.push({
              source: `${source.city} (${source.state})`,
              source_key: source.source_key,
              type: source.source_type,
              scraper,
              outcome: report.outcome,
              fetched: report.fetched + headFetched,
              mapped: report.mapped,
              inserted: report.inserted + headInserted,
              updated: report.updated + headUpdated,
              errors: report.errors,
              nextOffset: report.nextOffset,
              detail: report.detail,
              headWritten: headInserted + headUpdated,
            });
          } catch (err) {
            // Catch-all: a broken source must never crash the whole cron run.
            const message = err instanceof Error ? err.message : "Unknown error";
            logger.error("Error scraping source", { city: source.city, error: message });
            await markSourceError(source.source_key, message, source.notes);
            totalErrors++;
            outcomeCounts.fetch_failed = (outcomeCounts.fetch_failed ?? 0) + 1;
            results.push({
              source: `${source.city} (${source.state})`,
              source_key: source.source_key,
              type: source.source_type,
              scraper: resolveScraperKind(source.source_type, source.endpoint),
              outcome: "fetch_failed",
              fetched: 0,
              mapped: 0,
              inserted: 0,
              updated: 0,
              errors: 1,
              nextOffset: startOffset,
              detail: message,
              headWritten: 0,
            });
          }
        })
      );
    }
  } else {
    // Fallback: use the 6 hardcoded Socrata sources
    for (const source of PERMIT_SOURCES) {
      try {
        const report = await scrapeSocrataSource(source);
        totalInserted += report.inserted;
        totalUpdated += report.updated;
        totalErrors += report.errors;
        totalFetched += report.fetched;
        outcomeCounts[report.outcome] = (outcomeCounts[report.outcome] ?? 0) + 1;
        results.push({
          source: `${source.city} (${source.state})`,
          source_key: `hardcoded:${source.city}`,
          type: "socrata",
          scraper: "socrata",
          outcome: report.outcome,
          fetched: report.fetched,
          mapped: report.mapped,
          inserted: report.inserted,
          updated: report.updated,
          errors: report.errors,
          nextOffset: report.nextOffset,
          detail: report.detail,
          // Hardcoded-fallback path has no cursor, so it always reads the
          // newest page; there is no separate head lane to report.
          headWritten: 0,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("Error scraping source", { city: source.city, error: message });
        totalErrors++;
        outcomeCounts.fetch_failed = (outcomeCounts.fetch_failed ?? 0) + 1;
        results.push({
          source: `${source.city} (${source.state})`,
          source_key: `hardcoded:${source.city}`,
          type: "socrata",
          scraper: "socrata",
          outcome: "fetch_failed",
          fetched: 0,
          mapped: 0,
          inserted: 0,
          updated: 0,
          errors: 1,
          nextOffset: 0,
          detail: message,
          headWritten: 0,
        });
      }
    }
  }

  const summary = {
    totalInserted,
    totalUpdated,
    totalFetched,
    totalErrors,
    sourcesProcessed: results.length,
    budgetExhausted,
    outcomeCounts,
    // Cursors live per-source in permit_sources.notes (see lib/scrapers/cursor),
    // NOT in this blob — a 661-entry map written 24x/day would add ~90MB/month
    // to cron_runs on a DB that has already hit disk-full once.
    resumed: results.filter((r) => r.nextOffset > 0).length,
    // The number to watch. 0 across consecutive runs means the freshness
    // lane is not fetching anything, i.e. the head pass is broken or every
    // source in the rotation is sitting at cursor 0.
    headWritten: results.reduce((sum, r) => sum + r.headWritten, 0),
  };

  const failed = results.filter((r) => r.outcome !== "ok" && r.outcome !== "empty").length;
  await logCronRun(SCRAPE_CRON_PATH, startedAt, {
    pulled: totalFetched,
    inserted: totalInserted + totalUpdated,
    summary,
    trigger,
    status: failed > 0 && failed === results.length && results.length > 0 ? "partial" : "ok",
  });

  return NextResponse.json({
    success: true,
    usedDbSources: useDbSources,
    summary,
    results,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Guarantees an audit row even when the run dies.
 *
 * `runScrape` writes its cron_runs row on the LAST line of the happy path, so
 * every other exit — an unhandled throw, an early return, or Vercel killing
 * the function at the 300s wall — left no trace at all. The consequence was
 * not subtle: `scrape` is scheduled 24x/day and `cron_runs` contained ZERO
 * rows for it, ever, so the single most important job in the pipeline was
 * invisible to the data-health page and to every "is ingest alive?" query. A
 * failure that never logs is indistinguishable from a job that was never
 * scheduled, which is exactly the ambiguity that let this sit.
 *
 * The catch does not swallow: it records, then returns 500 so the fleet's
 * non-200 check still marks the workflow run failed.
 */
async function handler(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    return await runScrape(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("scrape.unhandled", { error: message });
    await logCronRun(SCRAPE_CRON_PATH, startedAt, {
      status: "error",
      error: message,
      trigger: detectTrigger(request),
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET  = handler;
export const POST = handler;
