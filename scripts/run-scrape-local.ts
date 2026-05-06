/**
 * Trigger /api/cron/scrape's logic locally — same scrapeSocrataSource /
 * scrapeArcGISSource path, same getActiveSources query, no Vercel cron
 * dependency. Use after a probe pass enables new sources to immediately
 * pull permits from them rather than waiting for the next 30-min tick.
 *
 *   npx tsx scripts/run-scrape-local.ts                 # process top 50 enabled sources
 *   SCRAPE_LIMIT=200 npx tsx scripts/run-scrape-local.ts
 */
import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });

import { scrapeSocrataSource } from "../src/lib/scrapers/socrata";
import { scrapeArcGISSource } from "../src/lib/scrapers/arcgis";
import {
  getActiveSources,
  markSourceScraped,
  markSourceError,
} from "../src/lib/scrapers/sources-db";

const LIMIT = Number(process.env.SCRAPE_LIMIT ?? 50);
const BATCH = 5; // matches the cron's batch-of-5 throttle

(async () => {
  const sources = await getActiveSources(LIMIT);
  console.log(`Loaded ${sources.length} enabled sources from DB`);
  if (sources.length === 0) {
    console.log("No enabled sources to scrape.");
    return;
  }

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  const results: Array<{ source: string; inserted: number; updated: number; errors: number }> = [];
  const t0 = Date.now();

  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    await Promise.allSettled(
      batch.map(async (source) => {
        const label = `${source.city ?? "?"} (${source.state})`;
        try {
          let result: { inserted: number; updated: number; errors: number };
          if (source.source_type === "arcgis") {
            result = await scrapeArcGISSource({
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
            });
          } else {
            result = await scrapeSocrataSource(source);
          }
          totalInserted += result.inserted;
          totalUpdated += result.updated;
          totalErrors += result.errors;
          results.push({
            source: label,
            inserted: result.inserted,
            updated: result.updated,
            errors: result.errors,
          });
          await markSourceScraped(source.source_key, result.inserted + result.updated);
          if (result.inserted + result.updated + result.errors > 0) {
            console.log(
              `  [${label}] inserted=${result.inserted} updated=${result.updated} errors=${result.errors}`,
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown error";
          console.warn(`  [${label}] FAILED: ${message.slice(0, 200)}`);
          await markSourceError(source.source_key);
          totalErrors++;
          results.push({ source: label, inserted: 0, updated: 0, errors: 1 });
        }
      }),
    );
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(
    `\nDone in ${elapsed}s. inserted=${totalInserted.toLocaleString()} updated=${totalUpdated.toLocaleString()} errors=${totalErrors} across ${results.length} sources`,
  );
})();
