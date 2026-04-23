/**
 * Smoke-test the Phase-5 scraper pipeline end-to-end against ONE
 * enabled permit_sources row — without spinning up the Next.js dev
 * server or triggering the cron.
 *
 * Picks the oldest `last_scraped_at IS NULL` ArcGIS source, runs it
 * through the same scraper the production cron uses, reports inserted
 * / updated / error counts, and updates the source's scrape metadata
 * (so it rotates out of the "never scraped" queue on its own timeline).
 *
 * Run: `npx tsx scripts/smoke-scraper.ts`
 */
import { getActiveSources, markSourceScraped, markSourceError } from "@/lib/scrapers/sources-db";
import { scrapeArcGISSource } from "@/lib/scrapers/arcgis";
import { scrapeSocrataSource } from "@/lib/scrapers/socrata";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

(async () => {
  const sources = await getActiveSources(5);
  if (sources.length === 0) {
    console.error("no active sources found — aborting smoke test");
    process.exit(1);
  }
  console.log(`Testing ${sources.length} of the oldest-unscraped enabled sources:\n`);

  for (const src of sources) {
    const label = `${src.source_key}  (${src.source_type}  ${src.city ?? ""}${src.state ? ", " + src.state : ""})`;
    console.log(`>>> ${label}`);
    console.log(`    endpoint: ${src.endpoint}`);
    console.log(`    mapping: id=${src.idField}  addr=${src.addressField}  date=${src.dateField}`);
    const t0 = Date.now();
    try {
      const result = src.source_type === "arcgis"
        ? await scrapeArcGISSource({
            source_key:    src.source_key,
            city:          src.city,
            state:         src.state,
            endpoint:      src.endpoint,
            id_field:      src.idField,
            type_field:    src.typeField,
            status_field:  src.statusField,
            desc_field:    src.descField,
            address_field: src.addressField,
            date_field:    src.dateField,
            value_field:   src.valueField,
          })
        : await scrapeSocrataSource(src);
      const ms = Date.now() - t0;
      console.log(`    → inserted=${result.inserted}  updated=${result.updated}  errors=${result.errors}  (${ms}ms)`);
      await markSourceScraped(src.source_key, result.inserted + result.updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.log(`    → THREW: ${msg}`);
      await markSourceError(src.source_key);
    }
    console.log();
  }
})();
