/**
 * CKAN datastore scraper.
 *
 * THE BUG THIS CLOSES
 * -------------------
 * /api/cron/scrape dispatched on `source.source_type === "arcgis"` and sent
 * EVERYTHING ELSE into the Socrata scraper — including 593 enabled
 * `source_type = 'ckan'` rows. CKAN is not Socrata: it answers
 * `?$limit=&$offset=` with an error or an HTML page, and the Socrata scraper
 * swallowed that and returned zeros. Boston (~658k permits) and Milwaukee
 * looked like empty cities for as long as they have been registered.
 *
 * CKAN's real read API is:
 *   GET {host}/api/3/action/datastore_search?resource_id={uuid}&limit=&offset=
 *   -> { success: true, result: { records: [...], total: N, fields: [...] } }
 *
 * `records` are flat JSON objects with the same shape Socrata returns, so the
 * row mapping is shared via ./flat-record.
 *
 * ENDPOINT SHAPES IN THE WILD
 * ---------------------------
 * `permit_sources` stores four different things under `source_type='ckan'`
 * (verified against live rows):
 *   1. .../api/3/action/datastore_search?resource_id=<uuid>   <- ready to use
 *   2. .../datastore/dump/<uuid>                               <- same resource, CSV dump URL
 *   3. .../dataset/<slug>                                      <- landing page; needs package_show
 *   4. .../api/download/v1/items/<id>/shapefile, KML, PDFs,
 *      journal articles, ArcGIS Hub pages                      <- not CKAN data at all
 *
 * 1-3 are scraped. 4 returns `unsupported`, LOUDLY — the caller counts that
 * as a failure so the 10-strike auto-disable finally culls those stubs
 * instead of them being re-probed forever.
 */

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

/** A CKAN endpoint we can page, or a dataset slug we must resolve first. */
export type CkanTarget =
  | { kind: "resource"; host: string; resourceId: string }
  | { kind: "package"; host: string; slug: string };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Work out what a stored `ckan` endpoint actually points at.
 *
 * Pure + exported so the classification rules are unit-testable — this is the
 * function that decides whether a source gets scraped or loudly rejected.
 */
export function resolveCkanTarget(endpoint: string): CkanTarget | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  const host = `${url.protocol}//${url.host}`;
  const path = url.pathname;

  // Shape 4 first — these are downloads/pages, never a datastore resource.
  if (/\/api\/download\/v1\/items\//i.test(path)) return null;
  if (/\.(kml|kmz|zip|pdf|xlsx?|shp|geojson|csv)$/i.test(path)) return null;

  // Shape 1: an explicit datastore_search (or datastore_search_sql) call.
  if (/\/api\/3\/action\/datastore_search/i.test(path)) {
    const resourceId = url.searchParams.get("resource_id");
    if (resourceId) return { kind: "resource", host, resourceId };
    return null;
  }

  // Any other /api/3/action/... (package_search, package_show, ...) — we can
  // only page a concrete resource, so only package_show w/ an id is useful.
  if (/\/api\/3\/action\//i.test(path)) {
    const id = url.searchParams.get("id");
    if (/package_show/i.test(path) && id) return { kind: "package", host, slug: id };
    return null;
  }

  // Shape 2: /datastore/dump/<uuid> — the CSV face of a datastore resource.
  const dump = path.match(/\/datastore\/dump\/([^/?#]+)/i);
  if (dump?.[1]) return { kind: "resource", host, resourceId: dump[1] };

  // /dataset/<slug>/resource/<uuid> — resource page, uuid is the resource id.
  const resourcePage = path.match(/\/dataset\/[^/]+\/resource\/([^/?#]+)/i);
  if (resourcePage?.[1] && UUID_RE.test(resourcePage[1])) {
    return { kind: "resource", host, resourceId: resourcePage[1] };
  }

  // Shape 3: /dataset/<slug> — landing page, resolve via package_show.
  const dataset = path.match(/\/dataset\/([^/?#]+)/i);
  if (dataset?.[1]) return { kind: "package", host, slug: dataset[1] };

  return null;
}

async function ckanFetch(url: string, timeoutMs = 25_000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // CKAN behind a WAF / error page returns HTML with a 200.
    throw new Error("response was not JSON");
  }
}

interface CkanEnvelope<T> {
  success?: boolean;
  error?: { message?: string; __type?: string };
  result?: T;
}

interface DatastoreResult {
  records?: Record<string, unknown>[];
  total?: number;
  fields?: Array<{ id?: string }>;
}

/**
 * Resolve a dataset slug to a datastore-backed resource id.
 *
 * Only `datastore_active` resources can be paged via datastore_search; a
 * dataset whose resources are all plain file downloads is genuinely not
 * scrapable through this path and is reported as such.
 */
export async function resolveResourceIdFromPackage(
  host: string,
  slug: string,
): Promise<string | null> {
  const json = (await ckanFetch(
    `${host}/api/3/action/package_show?id=${encodeURIComponent(slug)}`,
  )) as CkanEnvelope<{
    resources?: Array<{ id?: string; format?: string; datastore_active?: boolean; name?: string }>;
  }>;
  if (!json?.success || !json.result?.resources?.length) return null;

  const resources = json.result.resources;
  // Prefer a datastore-active resource whose name/format looks like permits,
  // then any datastore-active resource at all.
  const permitish = resources.find(
    (r) =>
      r.datastore_active &&
      r.id &&
      /permit/i.test(`${r.name ?? ""} ${r.format ?? ""}`),
  );
  const anyActive = resources.find((r) => r.datastore_active && r.id);
  return permitish?.id ?? anyActive?.id ?? null;
}

export interface CkanScrapeOptions {
  pageSize?: number;
  maxPages?: number;
  /** Row offset to resume from. See src/lib/scrapers/cursor.ts. */
  startOffset?: number;
}

export async function scrapeCkanSource(
  source: PermitSource,
  options: CkanScrapeOptions = {},
): Promise<ScrapeReport> {
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 20;
  const startOffset = Math.max(0, options.startOffset ?? 0);

  const target = resolveCkanTarget(source.endpoint);
  if (!target) {
    return emptyReport({
      outcome: "unsupported",
      detail:
        "endpoint is not a CKAN datastore resource (expected /api/3/action/datastore_search, " +
        "/datastore/dump/<id> or /dataset/<slug>)",
      nextOffset: startOffset,
      reachedEnd: false,
    });
  }

  let resourceId: string;
  if (target.kind === "resource") {
    resourceId = target.resourceId;
  } else {
    try {
      const resolved = await resolveResourceIdFromPackage(target.host, target.slug);
      if (!resolved) {
        return emptyReport({
          outcome: "unsupported",
          detail: `CKAN dataset '${target.slug}' has no datastore-active resource to page`,
          nextOffset: startOffset,
          reachedEnd: false,
        });
      }
      resourceId = resolved;
    } catch (err) {
      return emptyReport({
        outcome: "fetch_failed",
        detail: `package_show failed: ${err instanceof Error ? err.message : String(err)}`,
        nextOffset: startOffset,
        reachedEnd: false,
      });
    }
  }

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
  let observedKeys: string[] = [];
  let detail: string | null = null;
  let outcome: ScrapeOutcome;
  let writeAttempts = 0;
  let writeFailures = 0;

  for (let page = 0; page < maxPages; page++) {
    const url =
      `${target.host}/api/3/action/datastore_search` +
      `?resource_id=${encodeURIComponent(resourceId)}&limit=${pageSize}&offset=${offset}`;

    let envelope: CkanEnvelope<DatastoreResult>;
    try {
      envelope = (await ckanFetch(url)) as CkanEnvelope<DatastoreResult>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("CKAN fetch error", { city: source.city, page, offset, error: message });
      errors++;
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

    if (envelope?.success === false) {
      const message = envelope.error?.message ?? envelope.error?.__type ?? "CKAN returned success:false";
      if (page === 0) {
        return emptyReport({
          errors,
          outcome: "upstream_error",
          detail: message,
          nextOffset: startOffset,
          reachedEnd: false,
          pageSize,
        });
      }
      detail = `page ${page} upstream error: ${message}`;
      break;
    }

    const records = envelope?.result?.records ?? [];
    if (records.length === 0) {
      reachedEnd = true;
      offset = 0;
      break;
    }

    pages++;
    if (observedKeys.length === 0) {
      observedKeys = collectObservedKeys(records[0]);
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
        const { row, usable: rowUsable } = normalizeFlatRecord(record, source, "ckan");
        if (!row) continue;
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
            ? `no record yielded an id via id_field='${source.idField}'`
            : `${pageMapped} records had ids but none had an address or date ` +
              `(address_field='${source.addressField}', date_field='${source.dateField}')`,
        nextOffset: startOffset,
        reachedEnd: false,
        pageSize,
        pages,
      });
    }

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
        logger.error("CKAN upsert error", { city: source.city, error: error.message });
      } else {
        updated += data?.length ?? 0;
      }
    }

    offset += records.length;

    // CKAN reports the resource's total row count — use it to detect the end
    // precisely rather than waiting for an empty page.
    const total = Number(envelope?.result?.total);
    if (records.length < pageSize || (Number.isFinite(total) && offset >= total)) {
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
      `${fetched} records fetched, ${mapped} mapped, ${usable} usable — field mapping does not match payload`;
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
