import { NextRequest, NextResponse } from "next/server";
import { scrapeSocrataSource } from "@/lib/scrapers/socrata";
import { scrapeArcGISSource } from "@/lib/scrapers/arcgis";
import {
  getActiveSources,
  getSourcesByKeys,
  markSourceScraped,
  markSourceError,
} from "@/lib/scrapers/sources-db";
import { PERMIT_SOURCES } from "@/lib/scrapers/sources"; // fallback hardcoded sources
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET/POST /api/cron/scrape
 *
 * Scrapes enabled permit sources from the `permit_sources` DB table.
 * Falls back to the 6 hardcoded PERMIT_SOURCES if DB is empty.
 * Dispatches to the correct scraper based on source_type (socrata | arcgis).
 * Runs in batches of 5 concurrent sources to avoid rate limits.
 */
async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    source: string;
    type: string;
    inserted: number;
    updated: number;
    errors: number;
  }> = [];

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

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
          try {
            let result;

            if (source.source_type === "arcgis") {
              result = await scrapeArcGISSource({
                source_key:    source.source_key,
                city:          source.city,
                state:         source.state,
                endpoint:      source.endpoint,
                id_field:      source.idField,
                type_field:    source.typeField,
                status_field:  source.statusField,
                desc_field:    source.descField,
                address_field: source.addressField,
                date_field:    source.dateField,
                value_field:   source.valueField,
              });
            } else {
              // Socrata (and CKAN which uses the same JSON API shape)
              result = await scrapeSocrataSource(source);
            }

            await markSourceScraped(
              source.source_key,
              result.inserted + result.updated
            );

            totalInserted += result.inserted;
            totalUpdated  += result.updated;
            totalErrors   += result.errors;

            results.push({
              source: `${source.city} (${source.state})`,
              type:    source.source_type,
              inserted: result.inserted,
              updated:  result.updated,
              errors:   result.errors,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            logger.error("Error scraping source", { city: source.city, error: message });
            await markSourceError(source.source_key);
            totalErrors++;
            results.push({
              source:  `${source.city} (${source.state})`,
              type:     source.source_type,
              inserted: 0,
              updated:  0,
              errors:   1,
            });
          }
        })
      );
    }
  } else {
    // Fallback: use the 6 hardcoded Socrata sources
    for (const source of PERMIT_SOURCES) {
      try {
        const result = await scrapeSocrataSource(source);
        totalInserted += result.inserted;
        totalUpdated  += result.updated;
        totalErrors   += result.errors;
        results.push({
          source:  `${source.city} (${source.state})`,
          type:    "socrata",
          inserted: result.inserted,
          updated:  result.updated,
          errors:   result.errors,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("Error scraping source", { city: source.city, error: message });
        totalErrors++;
        results.push({
          source:  `${source.city} (${source.state})`,
          type:    "socrata",
          inserted: 0,
          updated:  0,
          errors:   1,
        });
      }
    }
  }

  return NextResponse.json({
    success: true,
    usedDbSources: useDbSources,
    summary: {
      totalInserted,
      totalUpdated,
      totalErrors,
      sourcesProcessed: results.length,
      budgetExhausted,
    },
    results,
    timestamp: new Date().toISOString(),
  });
}

export const GET  = handler;
export const POST = handler;
