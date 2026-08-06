/**
 * ArcGIS Feature Service scraper
 *
 * ArcGIS REST endpoints follow the pattern:
 *   {base}/query?where=1=1&outFields=*&f=json&resultOffset={n}&resultRecordCount={k}
 *
 * Response shape:
 *   { features: [{ attributes: { PERMIT_NUM: "...", ... }, geometry: { x: lng, y: lat } }] }
 *
 * Note: ArcGIS geometry uses x = longitude, y = latitude (opposite of typical lat/lng order).
 *
 * PAGINATION (fixed 2026-08-04)
 * -----------------------------
 * The old loop hard-coded a 1000-row page and stopped when
 * `exceededTransferLimit` was absent. Two ways that lost data:
 *
 *   1. `exceededTransferLimit` is an OPTIONAL field. Plenty of servers
 *      (and every `MapServer` on older ArcGIS builds) simply never send it,
 *      so paging stopped dead after page 0 — one page, ever.
 *   2. When a server's `maxRecordCount` is below 1000 it silently returns
 *      fewer rows than asked for. The old `features.length < 1000` check
 *      read that as "last page" and quit. Columbus caps at 500 and was
 *      ingesting ~0.15% of its catalog.
 *
 * The loop now pages on `resultOffset` / `resultRecordCount` and keeps going
 * while the returned feature count equals the page size it actually asked
 * for, honouring the server's advertised `maxRecordCount` when that is
 * smaller, and adopting the server's real cap at runtime if it silently
 * truncates a page while still flagging `exceededTransferLimit`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  classifyPermitType,
  normalizeStatus,
  parseDate,
  extractZip,
  deriveState,
  parseCoord,
  parseMoney,
  BROWSER_UA,
} from "./normalizer";
import {
  type ScrapeReport,
  type ScrapeOutcome,
  collectObservedKeys,
  emptyReport,
  isMappingFailure,
  looksLikeNonPermitDataset,
} from "./types";
import { coordinatePair } from "./geo";
import { extractContactWithProvenance } from "@/lib/ingest/extract-contact";

interface ArcGISSource {
  source_key: string;
  city: string;
  state: string;
  endpoint: string;        // Full FeatureServer/0 URL
  id_field: string;        // e.g. "PERMIT_NUMBER"
  type_field: string;
  status_field: string;
  desc_field: string;
  address_field: string;
  date_field: string;
  value_field: string;
}

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: { x: number; y: number } | null;
}

interface ArcGISResponse {
  features?: ArcGISFeature[];
  error?: { message: string };
  exceededTransferLimit?: boolean;
}

export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Newest-first ordering (2026-08-05).
 *
 * This query used to carry no `orderByFields` at all. Without one, ArcGIS
 * returns rows in whatever order the backend finds convenient — in practice
 * ascending OBJECTID, i.e. OLDEST FIRST. Combined with the resume cursor in
 * lib/scrapers/cursor.ts, that put every newly-issued permit at the very END
 * of a feed the cursor was walking from the front. A source with 1M rows of
 * history therefore had to be fully re-ingested — 50+ runs at 20k rows each —
 * before a permit issued today could be reached. Measured consequence, from
 * the 20:04 UTC run: 191,775 rows fetched, 186,704 updated, **0 inserted**.
 * The scraper was busy and productive-looking and could not surface a single
 * new permit.
 *
 * Ordering DESC makes offset 0 the newest page, which is what the freshness
 * pass in /api/cron/scrape depends on.
 *
 * `orderBy` is best-effort: ArcGIS rejects an unknown field with an in-band
 * `error` object (HTTP 200) rather than a status code, so the caller retries
 * once unordered and remembers the downgrade for the rest of the run. Worst
 * case we are back to the previous behaviour for that source, never worse.
 */
async function fetchArcGISPage(
  baseUrl: string,
  offset: number,
  limit: number = DEFAULT_PAGE_SIZE,
  orderBy: string | null = null,
): Promise<ArcGISResponse> {
  const order = orderBy ? `&orderByFields=${encodeURIComponent(orderBy)}` : "";
  const url = `${baseUrl}/query?where=1%3D1&outFields=*&f=json&resultOffset=${offset}&resultRecordCount=${limit}&returnGeometry=true${order}`;

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA },
      });
      if (!res.ok) {
        if (res.status >= 500 || res.status === 429) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as ArcGISResponse;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Layer metadata cache: endpoint -> advertised maxRecordCount (or null).
 *
 * One extra request per endpoint per process, not per run — a serverless
 * instance handles many sources, so this amortises well. Best-effort: any
 * failure returns null and we fall back to runtime inference.
 */
const maxRecordCountCache = new Map<string, number | null>();

export async function fetchMaxRecordCount(endpoint: string): Promise<number | null> {
  const cached = maxRecordCountCache.get(endpoint);
  if (cached !== undefined) return cached;

  let value: number | null = null;
  try {
    const res = await fetch(`${endpoint}?f=json`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const meta = (await res.json()) as { maxRecordCount?: unknown };
      const n = Number(meta?.maxRecordCount);
      if (Number.isFinite(n) && n > 0) value = Math.floor(n);
    }
  } catch {
    // Metadata is a nicety, never a blocker — runtime inference covers us.
    value = null;
  }
  maxRecordCountCache.set(endpoint, value);
  return value;
}

/** Test seam — lets unit tests exercise the paging loop deterministically. */
export function __resetMaxRecordCountCache(): void {
  maxRecordCountCache.clear();
}

/**
 * Decide the next paging step from one page's result.
 *
 * Pure so the pagination rules — the exact thing that was broken — can be
 * unit-tested without a network.
 *
 *   - `count === 0`                        -> stop, feed exhausted
 *   - `count === requested`                -> keep paging (the primary rule;
 *                                             NOT dependent on the optional
 *                                             `exceededTransferLimit` flag)
 *   - `count < requested` + limit flagged  -> the server capped us below what
 *                                             we asked for. Adopt `count` as
 *                                             the real page size and continue.
 *   - `count < requested`, no flag         -> genuine last page, stop
 */
export interface PageDecision {
  /** Continue paging? */
  next: boolean;
  /** Page size to request next time (may shrink to the server's real cap). */
  pageSize: number;
  /** True when we concluded the feed is exhausted. */
  reachedEnd: boolean;
}

export function decideNextPage(
  count: number,
  requested: number,
  exceededTransferLimit: boolean | undefined,
): PageDecision {
  if (count <= 0) return { next: false, pageSize: requested, reachedEnd: true };
  if (count >= requested) return { next: true, pageSize: requested, reachedEnd: false };
  if (exceededTransferLimit === true) {
    // Server truncated the page but says more rows exist: it caps at `count`.
    return { next: true, pageSize: count, reachedEnd: false };
  }
  return { next: false, pageSize: requested, reachedEnd: true };
}

/** Normalise an ArcGIS field value — attributes keys may be UPPER or mixed case */
function getField(attributes: Record<string, unknown>, fieldName: string | null | undefined): string | null {
  if (!fieldName) return null;
  // Try exact match first, then case-insensitive
  const val = attributes[fieldName] ?? attributes[fieldName.toLowerCase()] ?? attributes[fieldName.toUpperCase()];
  return val != null ? String(val) : null;
}

/**
 * Fallback ID resolver — tries the configured `source.id_field` first;
 * if that's null/missing or returns no value, walks a chain of common
 * ArcGIS permit-ID column names in priority order. Required because
 * 211,797 enabled rows in `permit_sources` have `id_field IS NULL`
 * (auto-imported by activate-arcgis-sources without manual schema
 * inspection). Without this fallback every row from those sources
 * silently drops at the `if (!rawId) return null` guard below.
 *
 * The chain order favors permit-number columns over OBJECTID because
 * permit numbers are stable across re-fetches; OBJECTID can re-number
 * if the upstream re-publishes the layer. We also include OBJECTID at
 * the end as a last-resort key (better dedupe key than nothing).
 */
const ID_FALLBACK_FIELDS = [
  "PermitNumber", "PERMIT_NUMBER", "PERMITNUMBER",
  "PermitNum", "PERMIT_NUM", "Permit_Number",
  "PermitID", "PERMIT_ID", "Permit_ID",
  "PermitNo", "PERMIT_NO", "Permit_No",
  "CASE_NUMBER", "CaseNumber", "Case_Number",
  "RecordID", "RECORD_ID", "RecordNumber", "RECORD_NUMBER",
  "BLDG_PERMIT", "BUILDING_PERMIT", "BUILDING_PERMIT_NUMBER",
  "ApplicationNumber", "APPLICATION_NUMBER", "APP_NUMBER",
  "OBJECTID", "objectid",
  "GlobalID", "GLOBALID",
] as const;

export function resolveId(
  attributes: Record<string, unknown>,
  configuredField: string | null | undefined,
): string | null {
  // Configured field wins when it produces a value
  const direct = configuredField ? getField(attributes, configuredField) : null;
  if (direct) return direct;
  // Fallback chain
  for (const fieldName of ID_FALLBACK_FIELDS) {
    const v = getField(attributes, fieldName);
    if (v) return v;
  }
  return null;
}

/**
 * Fetch one page, degrading to unordered if the server rejects the ordering.
 *
 * ArcGIS signals a bad `orderByFields` in-band — HTTP 200 with an `error`
 * object — so a status-code check alone would miss it and we would silently
 * treat an error envelope as an empty page.
 *
 * Returns the ordering that actually worked so the caller can stop paying for
 * a retry on every subsequent page of the same run.
 */
async function fetchPageWithOrderFallback(
  endpoint: string,
  offset: number,
  pageSize: number,
  orderBy: string | null,
): Promise<{ data: ArcGISResponse; orderBy: string | null }> {
  if (orderBy === null) {
    return { data: await fetchArcGISPage(endpoint, offset, pageSize, null), orderBy: null };
  }
  try {
    const data = await fetchArcGISPage(endpoint, offset, pageSize, orderBy);
    if (!data.error) return { data, orderBy };
    // Could be the ordering, could be something else. Retrying unordered
    // costs one request and tells us which: if the error persists it is
    // real and the existing page-0 error handling reports it unchanged.
    return { data: await fetchArcGISPage(endpoint, offset, pageSize, null), orderBy: null };
  } catch {
    return { data: await fetchArcGISPage(endpoint, offset, pageSize, null), orderBy: null };
  }
}

export interface ArcGISScrapeOptions {
  maxPages?: number;
  pageSize?: number;
  /** Row offset to resume from. See src/lib/scrapers/cursor.ts. */
  startOffset?: number;
}

export async function scrapeArcGISSource(
  source: ArcGISSource,
  options: ArcGISScrapeOptions = {},
): Promise<ScrapeReport> {
  const maxPages = options.maxPages ?? 20;
  const requestedPageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const startOffset = Math.max(0, options.startOffset ?? 0);

  const supabase = createAdminClient();
  const BATCH_SIZE = 100;

  // Respect the server's advertised cap when it is smaller than what we want.
  const advertised = await fetchMaxRecordCount(source.endpoint);
  let pageSize =
    advertised !== null ? Math.min(requestedPageSize, advertised) : requestedPageSize;

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
  let lastPageFingerprint: string | null = null;

  // Prefer the configured date field — "most recently issued" is the ordering
  // the freshness pass actually wants. Fall back to OBJECTID, which every
  // FeatureServer exposes and which increases with insertion order, so it is
  // a good proxy for recency when no date field is mapped. Either may be
  // rejected; fetchPageWithOrderFallback degrades to unordered if so.
  let orderBy: string | null = source.date_field
    ? `${source.date_field} DESC`
    : "OBJECTID DESC";

  for (let page = 0; page < maxPages; page++) {
    let data: ArcGISResponse;

    try {
      const res = await fetchPageWithOrderFallback(source.endpoint, offset, pageSize, orderBy);
      data = res.data;
      orderBy = res.orderBy;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("ArcGIS fetch error", { source_key: source.source_key, page, offset, error: message });
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

    if (data.error) {
      const message = data.error.message ?? "unknown ArcGIS error";
      logger.error("ArcGIS API error", { source_key: source.source_key, error: message });
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

    const features = data.features ?? [];
    const decision = decideNextPage(features.length, pageSize, data.exceededTransferLimit);

    if (features.length === 0) {
      // End of the feed — wrap so the next run re-sweeps from the top.
      reachedEnd = true;
      offset = 0;
      break;
    }

    pages++;
    if (observedKeys.length === 0) {
      observedKeys = collectObservedKeys(features[0]?.attributes);
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
    fetched += features.length;

    // Some legacy servers ignore `resultOffset` entirely and hand back page 0
    // forever. Detect it by fingerprinting the page rather than looping until
    // maxPages, which would burn the whole time budget re-writing one page.
    const fingerprint = `${features.length}:${JSON.stringify(
      features[0]?.attributes ?? {},
    ).slice(0, 200)}`;
    if (lastPageFingerprint !== null && fingerprint === lastPageFingerprint) {
      detail = "server ignores resultOffset — identical page returned twice";
      logger.warn("arcgis.pagination_not_supported", {
        source_key: source.source_key,
        offset,
      });
      reachedEnd = true;
      offset = 0;
      break;
    }
    lastPageFingerprint = fingerprint;

    const seen = new Set<string>();
    let pageMapped = 0;
    let pageUsable = 0;
    const normalized: Record<string, unknown>[] = [];

    for (const feature of features) {
      try {
        const attr = feature.attributes;
        const rawId = resolveId(attr, source.id_field);
        if (!rawId) continue;

        // ArcGIS feeds sometimes emit the same permit twice in one page
        // (different inspection rows, for instance). Upsert errors with
        // "cannot affect row a second time" unless we dedupe.
        const key = `${source.city.toLowerCase()}_${rawId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const rawAddress = getField(attr, source.address_field) ?? "";
        const rawDate = getField(attr, source.date_field);
        const rawValue = getField(attr, source.value_field);

        // ArcGIS geometry: x = longitude, y = latitude.
        // Both halves are validated TOGETHER (see geo.ts): a lone latitude is
        // always a wrong mapping, never real data. Falls back to explicit
        // LATITUDE / LONGITUDE attributes for feeds (Louisville etc.) that
        // ship EPSG:3857 geometry alongside real WGS84 columns.
        const geo =
          coordinatePair(feature.geometry?.y ?? null, feature.geometry?.x ?? null) ??
          coordinatePair(
            parseCoord(attr.LATITUDE ?? attr.latitude ?? attr.Latitude),
            parseCoord(attr.LONGITUDE ?? attr.longitude ?? attr.Longitude),
          );

        // Dedicated ZIP attribute FIRST — a structured column always beats
        // parsing free text. The old order asked extractZip first, and since
        // that returned the house number for any address starting with five
        // digits, this fallback was effectively dead code.
        const zipFromAttr = (() => {
          const raw = attr.ZIPCODE ?? attr.ZIP ?? attr.zipcode ?? attr.zip
            ?? attr.ZIP_CODE ?? attr.zip_code ?? attr.PostalCode ?? attr.POSTAL_CODE;
          if (raw == null) return null;
          const m = String(raw).match(/\b(\d{5})\b/);
          return m ? m[1] : null;
        })();
        const zipFromAddress = rawAddress ? extractZip(rawAddress) : null;
        const resolvedZip = zipFromAttr ?? zipFromAddress;
        const zipTrusted = zipFromAttr !== null;

        const issuedDate = parseDate(rawDate);

        pageMapped++;
        if (rawAddress || issuedDate !== null) pageUsable++;

        const row: Record<string, unknown> = {
          // source_id / source_city are the upsert conflict target and MUST
          // NOT change shape — see the source_key note below, and 00133.
          source_id:       `${source.city.toLowerCase().replace(/\s+/g, "_")}_${rawId}`,
          source_city:     source.city,
          city:            source.city,
          // Provenance only, never part of a unique constraint. 46% of
          // enabled sources have a blank `city`, so those permits all share
          // the namespace (source_city='', source_id='_<rawId>') and cannot
          // be attributed to their feed. Writing this cannot change which row
          // an upsert matches.
          ...(source.source_key ? { source_key: source.source_key } : {}),
          // Derive state from address/ZIP so junk 'US' source states
          // (e.g. auto-discovered sources) still yield correct rows — but a
          // free-text-parsed ZIP must never override the declared state.
          state:           deriveState(rawAddress || null, resolvedZip, source.state, zipTrusted),
          source_type:     "arcgis",
          permit_number:   rawId,
          permit_type:     classifyPermitType(getField(attr, source.type_field) ?? ""),
          status:          normalizeStatus(getField(attr, source.status_field) ?? ""),
          description:     getField(attr, source.desc_field),
          address:         rawAddress || null,
          zip:             resolvedZip,
          latitude:        geo?.lat ?? null,
          longitude:       geo?.lng ?? null,
          issued_date:     issuedDate,
          estimated_value: parseMoney(rawValue),
          // `contractor_name` is DELIBERATELY ABSENT from the base payload.
          //
          // It used to be `contractor_name: null`. The upsert runs with
          // merge-duplicates, so PostgREST compiles every supplied column
          // into ON CONFLICT DO UPDATE SET — meaning each re-scrape BLANKED
          // contractor names that scripts/backfill-contact-from-raw.ts had
          // recovered. The loss was unrecoverable: the same backfill also
          // writes applicant_name, which the ArcGIS payload does not touch,
          // so the row permanently dropped out of that script's
          // `.is("applicant_name", null)` re-scan. An absent key is left
          // untouched by ON CONFLICT DO UPDATE.
          raw_json:        attr,
          updated_at:      new Date().toISOString(),
        };

        // Populate the denormalised contact columns from the raw attributes —
        // ArcGIS feeds such as Bozeman MT ship CONTRACTOR_EMAIL and
        // CONTRACTOR_PHONE_1, which previously reached raw_json but never a
        // column. Only non-null values are added, so a sparse re-fetch can
        // never blank a value an earlier pass won.
        const contact = extractContactWithProvenance(attr);
        const applicant = contact.owner_name ?? contact.applicant_name;
        if (applicant) row.applicant_name = applicant;
        if (contact.contractor_name) row.contractor_name = contact.contractor_name;
        if (applicant || contact.contractor_name) {
          row.contact_source = contact.source;
          row.contact_confidence = contact.confidence;
          row.contact_extracted_at = new Date().toISOString();
        }

        normalized.push(row);
      } catch {
        errors++;
      }
    }

    mapped += pageMapped;
    usable += pageUsable;

    // MAPPING-FAILURE GATE (page 0 only) — see socrata.ts for the rationale.
    // ArcGIS matters most here: `resolveId` falls back to OBJECTID, which
    // almost always resolves, so a broken mapping used to produce a full page
    // of ID-only rows with no address and no date. Those upserted cleanly and
    // the run was recorded as a success.
    if (page === 0 && isMappingFailure(features.length, pageMapped, pageUsable)) {
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
            ? `no feature yielded an id via id_field='${source.id_field}' or the fallback chain`
            : `${pageMapped} features had ids but none had an address or date ` +
              `(address_field='${source.address_field}', date_field='${source.date_field}')`,
        nextOffset: startOffset,
        reachedEnd: false,
        pageSize,
        pages,
      });
    }

    // Upsert in batches
    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE);
      writeAttempts++;
      const { data: upserted, error } = await supabase
        .from("permits")
        .upsert(batch, { onConflict: "source_city,source_id" })
        .select("id");

      if (error) {
        errors += batch.length;
        writeFailures++;
        detail = `upsert failed: ${error.message}`;
        logger.error("ArcGIS upsert error", {
          source_key: source.source_key,
          error: error.message,
        });
      } else {
        updated += upserted?.length ?? 0;
      }
    }

    offset += features.length;
    pageSize = decision.pageSize;

    if (!decision.next) {
      reachedEnd = decision.reachedEnd;
      if (reachedEnd) offset = 0;
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
      `${fetched} features fetched, ${mapped} mapped, ${usable} usable — field mapping does not match payload`;
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
