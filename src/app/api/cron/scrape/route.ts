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
        { startOffset },
      ),
    };
  }

  if (scraper === "ckan") {
    return { scraper, report: await scrapeCkanSource(source, { startOffset }) };
  }

  if (scraper === "socrata") {
    return { scraper, report: await scrapeSocrataSource(source, { startOffset }) };
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

async function handler(request: NextRequest): Promise<NextResponse> {
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
            const { report, scraper } = await runOneSource(source, startOffset);

            await recordSourceRun(source.source_key, {
              outcome: report.outcome,
              rowCount: report.inserted + report.updated,
              fetched: report.fetched,
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

            totalInserted += report.inserted;
            totalUpdated += report.updated;
            totalErrors += report.errors;
            totalFetched += report.fetched;
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
              fetched: report.fetched,
              mapped: report.mapped,
              inserted: report.inserted,
              updated: report.updated,
              errors: report.errors,
              nextOffset: report.nextOffset,
              detail: report.detail,
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

export const GET  = handler;
export const POST = handler;
