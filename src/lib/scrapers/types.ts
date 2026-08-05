/**
 * Scraper outcome model.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module every scraper returned the same shape for three very
 * different situations:
 *
 *   { inserted: 0, updated: 0, errors: 0 }
 *
 *   (a) the city genuinely has no new permits          — success
 *   (b) the endpoint 404'd / returned HTML / timed out  — hard failure
 *   (c) the field mapping doesn't match the payload, so
 *       every row was silently dropped                  — silent failure
 *
 * The cron then called `markSourceScraped()` for all three, which resets
 * `error_count` to 0 unconditionally. `markSourceError()` was only ever
 * reached if a scraper THREW, and neither scraper threw — both swallowed
 * their errors and `break`ed out of the paging loop. Net effect: the
 * 10-strike auto-disable in `markSourceError()` was dead code, and ~12k
 * permanently-broken source stubs could never be culled.
 *
 * `ScrapeReport` makes the three cases distinguishable, so the cron can
 * decide correctly whether a run deserves an `error_count` reset.
 *
 * It EXTENDS `ScrapeResult` (src/types/permits.ts) rather than replacing
 * it, so every existing consumer of `{ inserted, updated, errors }` keeps
 * working unchanged.
 */

import type { ScrapeResult } from "@/types/permits";

export type ScrapeOutcome =
  /** Rows were fetched and mapped to permits. Healthy. */
  | "ok"
  /** Endpoint answered correctly with a well-formed empty result set. Healthy. */
  | "empty"
  /** Rows came back but ~none mapped — the field mapping is wrong. FAILURE. */
  | "mapping_failed"
  /** Transport/HTTP/JSON-parse failure reaching the endpoint. FAILURE. */
  | "fetch_failed"
  /** Endpoint answered with an error envelope (ArcGIS `error`, CKAN `success:false`). FAILURE. */
  | "upstream_error"
  /** Every DB upsert failed. FAILURE (ours, not theirs — still worth surfacing). */
  | "write_failed"
  /** No scraper can handle this source_type/endpoint combination. FAILURE. */
  | "unsupported";

/**
 * `true` when the outcome means "this run produced nothing trustworthy".
 *
 * Only `ok` and `empty` are allowed to reset `error_count` to 0 — an
 * `empty` result is a legitimately clean, well-formed response, so it
 * counts as the endpoint working.
 */
export function isFailureOutcome(outcome: ScrapeOutcome): boolean {
  return outcome !== "ok" && outcome !== "empty";
}

export interface ScrapeReport extends ScrapeResult {
  outcome: ScrapeOutcome;
  /** Raw rows/features returned upstream across every page this run. */
  fetched: number;
  /** Rows that produced a permit object (an ID was resolvable). */
  mapped: number;
  /** Rows with an ID *and* an address or a date — i.e. actually usable leads. */
  usable: number;
  /** fetched - mapped. Kept explicit because it is the number an operator reads. */
  skipped: number;
  /**
   * Offset the NEXT run should start from. 0 means "we reached the end of
   * the feed, wrap around to the newest rows".
   */
  nextOffset: number;
  /** True when the feed was exhausted this run (nextOffset wrapped to 0). */
  reachedEnd: boolean;
  /**
   * Keys present in the FIRST payload row. This is the single most useful
   * thing an operator needs to repair a broken mapping: it says what the
   * endpoint actually ships, next to what we configured.
   */
  observedKeys: string[];
  /** Human-readable reason, non-null on every failure outcome. */
  detail: string | null;
  /** Page size actually used (ArcGIS servers can cap below what we ask for). */
  pageSize: number;
  /** Pages fetched this run. */
  pages: number;
}

export function emptyReport(overrides: Partial<ScrapeReport> = {}): ScrapeReport {
  return {
    inserted: 0,
    updated: 0,
    errors: 0,
    outcome: "empty",
    fetched: 0,
    mapped: 0,
    usable: 0,
    skipped: 0,
    nextOffset: 0,
    reachedEnd: true,
    observedKeys: [],
    detail: null,
    pageSize: 0,
    pages: 0,
    ...overrides,
  };
}

/**
 * Minimum rows we need to see before "zero usable rows" is treated as proof
 * of a broken mapping.
 *
 * A 3-row page with no addresses is not evidence — it could be three genuinely
 * address-less permits. A 25+ row page where NOT ONE row yielded an address or
 * a date can only mean the configured column names don't exist in the payload.
 */
export const MIN_MAPPING_SAMPLE = 25;

/**
 * Decide whether a page of results represents a broken field mapping.
 *
 * Two distinct signals, both meaning "wrong mapping, not empty city":
 *
 *   1. `mapped === 0` while rows came back — not a single row yielded an ID.
 *      The `id_field` (and, for ArcGIS, the whole fallback chain) missed.
 *      True at ANY sample size: an endpoint that ships rows always has
 *      *some* identifier.
 *
 *   2. IDs resolved but `usable === 0` over a decent sample — we got IDs
 *      (often from the ArcGIS OBJECTID last-resort fallback) yet not one row
 *      produced an address or a date. Those rows are unactionable noise and
 *      the address/date columns are certainly misconfigured.
 *
 * Pure function so it is unit-testable without a network or a database.
 */
export function isMappingFailure(
  fetched: number,
  mapped: number,
  usable: number,
): boolean {
  if (fetched <= 0) return false;
  if (mapped === 0) return true;
  return fetched >= MIN_MAPPING_SAMPLE && usable === 0;
}

/** Cap on how many payload keys we persist — notes is a text column, not a dump. */
const MAX_OBSERVED_KEYS = 40;

/** Collect the keys of the first payload row, truncated + sorted for stable diffs. */
export function collectObservedKeys(row: Record<string, unknown> | null | undefined): string[] {
  if (!row || typeof row !== "object") return [];
  return Object.keys(row).sort().slice(0, MAX_OBSERVED_KEYS);
}

/**
 * Column names that only appear in datasets that are NOT permit datasets.
 * Deliberately narrow — every entry is evidenced from a live source that was
 * writing non-permit rows into `public.permits`.
 */
const NON_PERMIT_MARKERS = [
  // Business-licence registries. Elk Grove's
  // `city-of-elk-grove-business-licenses` alone wrote 20,000 rows.
  "license_number",
  "licensenumber",
  "license_subtype",
  "licensesubtype",
  "business_license",
  // Sewer-wye inventory. `arcgis:LA:los-angeles:wyes` is enabled with
  // last_count 934,112 and lat_field='WYE_NO'.
  "wye_no",
  "wyeno",
  // Wetland / land-cover layers.
  "wetland_type",
  "attribute_wetland",
] as const;

/** Any of these means the payload really is permit-shaped. */
const PERMIT_MARKERS = ["permit", "application", "case_number", "casenumber", "job_"] as const;

/**
 * Detect a registry mis-registration: a source enabled as a permit feed whose
 * payload is a business-licence / footprint / utility layer.
 *
 * These rows used to ingest cleanly — Elk Grove produced 22,519 `permits`
 * rows from a business-licence feed and a building-footprint feed, with
 * `address` set to a unit number ("A", "C") and 109 of them already promoted
 * into the sellable lead pipeline. They also inflate the public permit count
 * rendered on the landing page, which the truthfulness rule forbids.
 *
 * Conservative on purpose: fires ONLY when a strong non-permit marker is
 * present AND no permit marker is. Returns a reason string, or null.
 *
 * Pure + unit-testable.
 */
export function looksLikeNonPermitDataset(observedKeys: string[]): string | null {
  if (observedKeys.length === 0) return null;
  const lower = observedKeys.map((k) => k.toLowerCase());
  if (lower.some((k) => PERMIT_MARKERS.some((m) => k.includes(m)))) return null;
  const hit = lower.find((k) => NON_PERMIT_MARKERS.some((m) => k.includes(m)));
  return hit
    ? `payload looks like a non-permit dataset (found '${hit}', no permit-shaped column present)`
    : null;
}

const DIAG_OPEN = "[henri:scrape-diagnostic]";
const DIAG_CLOSE = "[/henri:scrape-diagnostic]";

/**
 * Replace (or remove) a single delimited machine block inside a free-text
 * field, preserving every other character.
 *
 * `permit_sources.notes` is the only free-text column on the table, and
 * adding dedicated columns would need a migration. So the scrapers own a
 * couple of delimited blocks inside it — each function only ever touches its
 * own delimiters, so a diagnostic block and a cursor block coexist happily
 * and operator prose is never destroyed.
 *
 * Pass `body: null` to strip the block entirely.
 *
 * Pure + testable.
 */
export function spliceBlock(
  existing: string | null,
  open: string,
  close: string,
  body: string | null,
): string {
  const prior = existing ?? "";
  const start = prior.indexOf(open);
  let base = prior;
  if (start !== -1) {
    const end = prior.indexOf(close, start);
    base =
      end === -1
        ? prior.slice(0, start)
        : prior.slice(0, start) + prior.slice(end + close.length);
  }
  base = base.trim();
  if (body === null) return base;
  const block = `${open} ${body} ${close}`;
  return base ? `${base}\n${block}` : block;
}

/** Read the body of a delimited machine block, or null when absent. */
export function readBlock(
  existing: string | null,
  open: string,
  close: string,
): string | null {
  if (!existing) return null;
  const start = existing.indexOf(open);
  if (start === -1) return null;
  const end = existing.indexOf(close, start);
  if (end === -1) return null;
  return existing.slice(start + open.length, end).trim();
}

/**
 * Splice a machine-written diagnostic into `permit_sources.notes` without
 * destroying whatever an operator typed there.
 */
export function withDiagnostic(existing: string | null, body: string): string {
  return spliceBlock(existing, DIAG_OPEN, DIAG_CLOSE, body);
}

/**
 * Drop the diagnostic block. Called when a source starts working again so
 * `notes` never keeps asserting a failure that has since been fixed.
 */
export function clearDiagnostic(existing: string | null): string {
  return spliceBlock(existing, DIAG_OPEN, DIAG_CLOSE, null);
}

/** Render the diagnostic body an operator needs to repair a mapping. */
export function buildMappingDiagnostic(params: {
  outcome: ScrapeOutcome;
  fetched: number;
  mapped: number;
  usable: number;
  observedKeys: string[];
  configured: Record<string, string | null | undefined>;
  detail: string | null;
  at?: Date;
}): string {
  const at = (params.at ?? new Date()).toISOString();
  const configured = Object.entries(params.configured)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return [
    `${at}`,
    `outcome=${params.outcome}`,
    `fetched=${params.fetched} mapped=${params.mapped} usable=${params.usable}`,
    params.detail ? `detail=${params.detail}` : null,
    configured ? `configured: ${configured}` : null,
    params.observedKeys.length
      ? `payload_keys: ${params.observedKeys.join(",")}`
      : `payload_keys: (none captured)`,
  ]
    .filter(Boolean)
    .join(" | ");
}
