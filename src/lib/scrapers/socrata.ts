import type { PermitSource } from "./sources";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { BROWSER_UA } from "./normalizer";
import { normalizeFlatRecord } from "./flat-record";
import {
  type ScrapeReport,
  type ScrapeOutcome,
  collectObservedKeys,
  emptyReport,
  isMappingFailure,
  looksLikeNonPermitDataset,
} from "./types";

/** Build Socrata request headers — browser UA (some gov WAFs 403 bot
 *  agents) + app token when available to avoid rate limits. */
function socrataHeaders(): Record<string, string> {
  const token = process.env.SOCRATA_APP_TOKEN;
  const base: Record<string, string> = { "User-Agent": BROWSER_UA };
  if (token) base["X-App-Token"] = token;
  return base;
}

/** A 4xx that retrying cannot fix — surfaced so callers can fall back. */
export class HttpClientError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = "HttpClientError";
    this.status = status;
  }
}

async function fetchWithRetry(
  url: string,
  retries: number = 3
): Promise<Response> {
  const headers = socrataHeaders();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { headers });

      if (response.ok) return response;

      // Retry on server errors and rate limits
      if (response.status >= 500 || response.status === 429) {
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      throw new HttpClientError(response.status, response.statusText);
    } catch (error) {
      // A 4xx is deterministic — retrying just burns the time budget.
      if (error instanceof HttpClientError && error.status < 500 && error.status !== 429) {
        throw error;
      }
      if (attempt === retries) throw error;

      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Max retries exceeded");
}

export interface SocrataScrapeOptions {
  pageSize?: number;
  maxPages?: number;
  /** Row offset to resume from. See src/lib/scrapers/cursor.ts. */
  startOffset?: number;
}

/**
 * Fetch one Socrata page.
 *
 * Ordering by the system field `:id` DESC pulls the NEWEST rows first, so a
 * cursor walking forward marches back through history. Some endpoints tagged
 * `socrata` in `permit_sources` are not really Socrata and reject `$order`
 * with a 400 — rather than let that cull a source that would otherwise work,
 * we retry once without the clause and remember the downgrade for this run.
 */
async function fetchSocrataPage(
  endpoint: string,
  pageSize: number,
  offset: number,
  ordered: boolean,
): Promise<{ records: Record<string, unknown>[]; ordered: boolean }> {
  const base = `${endpoint}?$limit=${pageSize}&$offset=${offset}`;
  const url = ordered ? `${base}&$order=:id+DESC` : base;
  try {
    const response = await fetchWithRetry(url);
    const json = await response.json();
    if (!Array.isArray(json)) {
      throw new Error("response was not a JSON array");
    }
    return { records: json as Record<string, unknown>[], ordered };
  } catch (err) {
    if (ordered && err instanceof HttpClientError && err.status >= 400 && err.status < 500) {
      const response = await fetchWithRetry(base);
      const json = await response.json();
      if (!Array.isArray(json)) throw new Error("response was not a JSON array");
      return { records: json as Record<string, unknown>[], ordered: false };
    }
    throw err;
  }
}

export async function scrapeSocrataSource(
  source: PermitSource,
  options: SocrataScrapeOptions = {},
): Promise<ScrapeReport> {
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 20;
  const startOffset = Math.max(0, options.startOffset ?? 0);

  const supabase = createAdminClient();
  const seen = new Set<string>();

  let offset = startOffset;
  let fetched = 0;
  let mapped = 0;
  let usable = 0;
  let updated = 0;
  let errors = 0;
  let pages = 0;
  let reachedEnd = false;
  let ordered = true;
  let observedKeys: string[] = [];
  let outcome: ScrapeOutcome = "empty";
  let detail: string | null = null;
  let writeAttempts = 0;
  let writeFailures = 0;

  for (let page = 0; page < maxPages; page++) {
    let records: Record<string, unknown>[];
    try {
      const res = await fetchSocrataPage(source.endpoint, pageSize, offset, ordered);
      records = res.records;
      ordered = res.ordered;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Socrata fetch error", { city: source.city, page, offset, error: message });
      errors++;
      // A failure on the very first page means we learned nothing this run —
      // that is a hard failure the cron must record so error_count climbs.
      // A failure on a later page still leaves real rows written, so we keep
      // the partial success and resume from the current offset next time.
      if (page === 0) {
        return emptyReport({
          errors,
          outcome: "fetch_failed",
          detail: message,
          nextOffset: startOffset,
          reachedEnd: false,
          pageSize,
        });
      }
      detail = `page ${page} fetch failed: ${message}`;
      break;
    }

    pages++;

    if (records.length === 0) {
      // End of the feed. Wrap so the next run re-sweeps from the newest rows;
      // every write is an upsert on (source_city, source_id) so re-sweeping is
      // free of side effects.
      reachedEnd = true;
      offset = 0;
      break;
    }

    if (observedKeys.length === 0) {
      observedKeys = collectObservedKeys(records[0]);
      // Registry mis-registration guard: refuse to write business-licence /
      // footprint / utility rows into `permits` at all.
      const nonPermit = looksLikeNonPermitDataset(observedKeys);
      if (nonPermit) {
        return emptyReport({
          errors,
          outcome: "unsupported",
          observedKeys,
          detail: nonPermit,
          nextOffset: startOffset,
          reachedEnd: false,
          pageSize,
        });
      }
    }
    fetched += records.length;

    let pageMapped = 0;
    let pageUsable = 0;
    const normalized: Record<string, unknown>[] = [];

    for (const record of records) {
      try {
        const { row, usable: rowUsable } = normalizeFlatRecord(record, source, "socrata");
        if (!row) continue;
        // Socrata pages can contain duplicate permit numbers; dedupe to avoid
        // "ON CONFLICT DO UPDATE command cannot affect row a second time".
        const dedupeKey = String(row.source_id);
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        pageMapped++;
        if (rowUsable) pageUsable++;
        normalized.push(row);
      } catch {
        errors++;
      }
    }

    mapped += pageMapped;
    usable += pageUsable;

    // MAPPING-FAILURE GATE (page 0 only).
    //
    // Before this existed, a source whose field mapping did not match the
    // payload returned {fetched:N, inserted:0, skipped:N} and was recorded as
    // a SUCCESS — indistinguishable from a genuinely quiet city. Now the first
    // page decides: if nothing mapped, we neither write the junk nor keep
    // paging, and the caller records a mapping failure with the payload keys
    // attached so an operator can repair the config.
    if (page === 0 && isMappingFailure(records.length, pageMapped, pageUsable)) {
      return emptyReport({
        errors,
        outcome: "mapping_failed",
        fetched,
        mapped,
        usable,
        skipped: fetched - mapped,
        observedKeys,
        detail:
          pageMapped === 0
            ? `no row yielded an id via id_field='${source.idField}'`
            : `${pageMapped} rows had ids but none had an address or date ` +
              `(address_field='${source.addressField}', date_field='${source.dateField}')`,
        nextOffset: startOffset,
        reachedEnd: false,
        pageSize,
        pages,
      });
    }

    // Upsert in batches of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE);
      writeAttempts++;
      const { data, error } = await supabase
        .from("permits")
        .upsert(batch, { onConflict: "source_city,source_id" })
        .select("id");

      if (error) {
        errors += batch.length;
        writeFailures++;
        detail = `upsert failed: ${error.message}`;
        logger.error("Socrata upsert error", { city: source.city, error: error.message });
      } else {
        // Supabase upsert does not distinguish insert vs update in the
        // response, so all successful rows are counted as updates.
        updated += data?.length ?? 0;
      }
    }

    offset += records.length;

    // Short page = last page of the feed.
    if (records.length < pageSize) {
      reachedEnd = true;
      offset = 0;
      break;
    }
  }

  if (writeAttempts > 0 && writeFailures === writeAttempts) {
    outcome = "write_failed";
    detail = detail ?? "every upsert batch failed";
  } else if (fetched === 0) {
    outcome = "empty";
  } else if (isMappingFailure(fetched, mapped, usable)) {
    outcome = "mapping_failed";
    detail =
      detail ??
      `${fetched} rows fetched, ${mapped} mapped, ${usable} usable — field mapping does not match payload`;
  } else {
    outcome = "ok";
  }

  return {
    inserted: 0,
    updated,
    errors,
    outcome,
    fetched,
    mapped,
    usable,
    skipped: fetched - mapped,
    nextOffset: reachedEnd ? 0 : offset,
    reachedEnd,
    observedKeys,
    detail,
    pageSize,
    pages,
  };
}
