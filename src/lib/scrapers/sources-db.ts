/**
 * DB-driven permit source loader
 *
 * Loads active scraping configurations from the `permit_sources` table
 * instead of using the hardcoded PERMIT_SOURCES array.
 *
 * Two-lane rotation (2026-06-09 starvation fix): producers (last_count > 0)
 * get 60% of each run's slots so proven city feeds stay fresh; explorers
 * (never-produced) fill the rest so new endpoints still get probed. The old
 * pure `last_scraped_at ASC NULLS FIRST` order let the ~50 never-scraped
 * stubs that activate-arcgis-sources enables daily monopolize every run —
 * verified feeds (e.g. Tampa, the only territory-holding market) starved
 * for 7+ weeks behind 12k unverified hub stubs.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { PermitSource } from "./sources";
import {
  type ScrapeOutcome,
  buildMappingDiagnostic,
  clearDiagnostic,
  isFailureOutcome,
  withDiagnostic,
} from "./types";
import { readCursor, writeCursor } from "./cursor";

export interface DBPermitSource extends PermitSource {
  source_key: string;
  /**
   * Raw `permit_sources.source_type`. Deliberately `string`, NOT a union:
   * the live table holds 40+ distinct values ('unknown', 'csv', 'tyler',
   * 'etrakit', 'html', ...), and the old narrow union was a cast-shaped lie
   * that hid the fact that everything except 'arcgis' was being funnelled
   * into the Socrata scraper. Routing happens in ./dispatch.
   */
  source_type: string;
  auth: string;
  update_freq: string | null;
  layer_index: number;
  /**
   * Mapping columns that were NULL in `permit_sources` and therefore filled
   * with a GUESS ("id", "address", "issue_date", ...).
   *
   * Live counts when this was added: of 239,883 enabled sources, 236,602 had
   * `address_field IS NULL` and 235,108 had `id_field IS NULL`, and 23,215
   * enabled sources with id/address/date ALL NULL had `last_count > 0` — the
   * guesses were actively writing rows. Nothing surfaced that, so a source
   * running entirely on guessed column names looked identical to a
   * hand-verified one. Carried through to the failure diagnostic so an
   * operator can see at a glance that the mapping was never configured.
   */
  unmappedFields: string[];
  /** Raw `permit_sources.notes` — carries the cursor + diagnostic blocks. */
  notes: string | null;
  /**
   * Row offset this source should resume from, decoded from `notes`.
   * 0 == start at the newest rows. See ./cursor.
   */
  cursorOffset: number;
}

const SOURCE_COLUMNS =
  "source_key, city, jurisdiction, state, endpoint, source_type, auth, update_freq, layer_index, id_field, type_field, status_field, desc_field, address_field, date_field, value_field, lat_field, lng_field, enabled, notes";

/** Column -> guessed default, applied when `permit_sources` has no mapping. */
const FIELD_DEFAULTS: Array<[keyof PermitSource, string, string]> = [
  ["idField", "id_field", "id"],
  ["typeField", "type_field", "permit_type"],
  ["statusField", "status_field", "status"],
  ["descField", "desc_field", "description"],
  ["addressField", "address_field", "address"],
  ["dateField", "date_field", "issue_date"],
  ["valueField", "value_field", "estimated_value"],
  ["latField", "lat_field", "latitude"],
  ["lngField", "lng_field", "longitude"],
];

type SourceRow = Record<string, unknown>;

/** Map a `permit_sources` row to a DBPermitSource, recording every guess. */
function toDBPermitSource(row: SourceRow): DBPermitSource {
  const unmappedFields: string[] = [];
  const mapping = {} as Record<keyof PermitSource, string>;
  for (const [tsKey, dbKey, fallback] of FIELD_DEFAULTS) {
    const raw = row[dbKey];
    const value = raw == null || String(raw).trim() === "" ? null : String(raw);
    if (value === null) unmappedFields.push(dbKey);
    mapping[tsKey] = value ?? fallback;
  }

  const notes = row.notes != null ? String(row.notes) : null;

  return {
    source_key: String(row.source_key ?? ""),
    city: String(row.city ?? row.jurisdiction ?? ""),
    state: String(row.state ?? ""),
    endpoint: String(row.endpoint ?? ""),
    source_type: String(row.source_type ?? ""),
    auth: String(row.auth ?? "none"),
    update_freq: row.update_freq != null ? String(row.update_freq) : null,
    layer_index: Number(row.layer_index ?? 0),
    unmappedFields,
    notes,
    cursorOffset: readCursor(notes),
    idField: mapping.idField,
    typeField: mapping.typeField,
    statusField: mapping.statusField,
    descField: mapping.descField,
    addressField: mapping.addressField,
    dateField: mapping.dateField,
    valueField: mapping.valueField,
    latField: mapping.latField,
    lngField: mapping.lngField,
  };
}

export async function getActiveSources(limit = 50): Promise<DBPermitSource[]> {
  const supabase = createAdminClient();

  const producerSlots = Math.ceil(limit * 0.6);

  // priority DESC first in BOTH lanes so human-verified / high-value
  // sources (priority=10, e.g. the Tampa territory feed + GOLD contact
  // feeds) always scrape before the long tail, then last_scraped_at
  // rotates within each priority band.
  const [producersRes, explorersRes] = await Promise.all([
    // Lane A: proven producers, highest priority + oldest-scraped first.
    supabase
      .from("permit_sources")
      .select(SOURCE_COLUMNS)
      .eq("enabled", true)
      .gt("last_count", 0)
      .order("priority", { ascending: false })
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .limit(producerSlots),
    // Lane B: never-produced explorers (NULL or 0 last_count).
    supabase
      .from("permit_sources")
      .select(SOURCE_COLUMNS)
      .eq("enabled", true)
      .or("last_count.is.null,last_count.eq.0")
      .order("priority", { ascending: false })
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .limit(limit),
  ]);

  if (producersRes.error && explorersRes.error) {
    logger.error("Failed to load permit sources from DB", {
      error: producersRes.error.message,
    });
    return [];
  }
  if (producersRes.error) {
    logger.warn("Producer-lane query failed; running explorers only", {
      error: producersRes.error.message,
    });
  }
  if (explorersRes.error) {
    logger.warn("Explorer-lane query failed; running producers only", {
      error: explorersRes.error.message,
    });
  }

  const producers = producersRes.data ?? [];
  const seen = new Set(producers.map((r) => r.source_key));
  const data = [
    ...producers,
    ...(explorersRes.data ?? []).filter((r) => !seen.has(r.source_key)),
  ].slice(0, limit);

  return (data ?? []).map((row) => toDBPermitSource(row as SourceRow));
}

/**
 * Fetch specific sources by key, bypassing the producer/explorer rotation.
 *
 * Exists so a newly-registered feed can actually be TESTED. getActiveSources()
 * splits every run 60/40 between proven producers and the ~12k never-produced
 * explorer stubs, so a freshly-added high-value source can wait many runs for a
 * slot — and until it gets one there is no way to tell a correct field mapping
 * from a wrong one. Used by /api/cron/scrape?source_key=a,b,c.
 *
 * Still respects `enabled`, so this cannot resurrect a deliberately-disabled
 * source.
 */
export async function getSourcesByKeys(keys: string[]): Promise<DBPermitSource[]> {
  if (keys.length === 0) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("permit_sources")
    .select(SOURCE_COLUMNS)
    .in("source_key", keys)
    .eq("enabled", true);

  if (error) {
    logger.error("sources-db.by-keys-failed", { error: error.message, keys });
    return [];
  }

  return (data ?? []).map((row) => toDBPermitSource(row as SourceRow));
}

/** Consecutive failures before a source is auto-disabled. */
export const MAX_CONSECUTIVE_ERRORS = 10;

export interface SourceRunRecord {
  outcome: ScrapeOutcome;
  /** Rows actually written this run. */
  rowCount: number;
  fetched?: number;
  mapped?: number;
  usable?: number;
  observedKeys?: string[];
  detail?: string | null;
  /** The mapping we used, echoed into the diagnostic so ops can diff it. */
  configured?: Record<string, string | null | undefined>;
  /**
   * `permit_sources.notes` as loaded with the source. Passed in so the
   * cursor + diagnostic blocks can be rewritten without an extra SELECT.
   */
  notes?: string | null;
  /**
   * Offset the NEXT run should resume at; 0 means the feed was exhausted and
   * the cursor should wrap. Only applied on a healthy outcome — a failed run
   * must not skip a window it never actually read. Omit to leave the stored
   * cursor untouched.
   */
  nextOffset?: number | null;
}

/**
 * Record the result of one scrape attempt against a source.
 *
 * REPLACES the old `markSourceScraped()` + `markSourceError()` pair, whose
 * combination made the 10-strike auto-disable dead code:
 *
 *   - `markSourceScraped()` set `error_count: 0` UNCONDITIONALLY, and the
 *     cron called it for every run that did not throw.
 *   - Neither scraper ever threw — both caught their own fetch errors and
 *     `break`ed out of the paging loop — so `markSourceError()` was only
 *     reachable via a bug in the cron itself.
 *
 * Net effect: `error_count` was pinned at 0 forever and ~12k permanently
 * broken source stubs could never be culled.
 *
 * The rules now:
 *
 *   - `ok` / `empty`   -> error_count reset to 0. `empty` counts as healthy
 *                         because a well-formed empty response proves the
 *                         endpoint works; only `ok` updates `last_count`, so
 *                         a quiet week never demotes a producer out of the
 *                         producer lane.
 *   - anything else    -> error_count += 1, auto-disable at
 *                         MAX_CONSECUTIVE_ERRORS.
 *
 * `last_scraped_at` is stamped on EVERY path, success or failure. That is a
 * fix in itself: the old error path left it untouched, and the rotation
 * orders by `last_scraped_at ASC NULLS FIRST`, so a source that failed kept
 * getting re-picked ahead of everything else and starved the queue.
 *
 * Never throws — a bookkeeping failure must not abort the cron run.
 */
export async function recordSourceRun(
  sourceKey: string,
  record: SourceRunRecord,
): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date();

  try {
    const failed = isFailureOutcome(record.outcome);

    if (!failed) {
      const update: Record<string, unknown> = {
        last_scraped_at: now.toISOString(),
        error_count: 0,
      };
      // Only a run that actually produced rows moves `last_count` — that
      // column drives the producer/explorer lane split, so a legitimately
      // empty run must not demote a proven producer to the explorer lane.
      if (record.outcome === "ok") update.last_count = record.rowCount;

      // A source that previously failed its mapping and now maps cleanly is
      // no longer 'failed'. Downgrade to 'probed' rather than claiming
      // 'verified' — a human never confirmed the schema.
      const { data: current } = await supabase
        .from("permit_sources")
        .select("field_mapping_status")
        .eq("source_key", sourceKey)
        .maybeSingle();
      if (record.outcome === "ok" && current?.field_mapping_status === "failed") {
        update.field_mapping_status = "probed";
      }

      // BLOCKER 3: persist the resume offset. Clearing the stale diagnostic
      // at the same time keeps `notes` honest — a source that now works
      // should not still be carrying last month's failure block.
      if (record.nextOffset != null) {
        update.notes = writeCursor(
          clearDiagnostic(record.notes ?? null),
          record.nextOffset,
          now,
        );
      }

      await supabase.from("permit_sources").update(update).eq("source_key", sourceKey);
      return;
    }

    // ── failure path ──────────────────────────────────────────────────────
    const { data: current } = await supabase
      .from("permit_sources")
      .select("error_count, notes")
      .eq("source_key", sourceKey)
      .maybeSingle();

    // Prefer the notes we were handed (already loaded with the source) and
    // fall back to the freshly-read value.
    const priorNotes = record.notes !== undefined ? record.notes : (current?.notes ?? null);
    const newCount = (current?.error_count ?? 0) + 1;
    const update: Record<string, unknown> = {
      last_scraped_at: now.toISOString(),
      error_count: newCount,
      enabled: newCount < MAX_CONSECUTIVE_ERRORS,
    };

    // BLOCKER 2: a wrong field mapping used to be indistinguishable from an
    // empty city. Persist enough for an operator to repair it without
    // re-probing the endpoint by hand: what we asked for, what came back.
    if (record.outcome === "mapping_failed" || record.outcome === "unsupported") {
      update.field_mapping_status = "failed";
    }
    // The cursor block is deliberately left as-is on failure: a run that
    // never read its window must not advance past it.
    update.notes = withDiagnostic(
      priorNotes,
      buildMappingDiagnostic({
        outcome: record.outcome,
        fetched: record.fetched ?? 0,
        mapped: record.mapped ?? 0,
        usable: record.usable ?? 0,
        observedKeys: record.observedKeys ?? [],
        configured: record.configured ?? {},
        detail: record.detail ?? null,
        at: now,
      }),
    );

    await supabase.from("permit_sources").update(update).eq("source_key", sourceKey);

    if (newCount >= MAX_CONSECUTIVE_ERRORS) {
      logger.warn("scrape.source_auto_disabled", {
        source_key: sourceKey,
        outcome: record.outcome,
        error_count: newCount,
        detail: record.detail,
      });
    }
  } catch (err) {
    logger.warn("scrape.record_run_failed", {
      source_key: sourceKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Increment error count on a source (disables after 10 consecutive errors).
 *
 * Kept for the cron's outer catch-all — the path taken when something
 * unexpected throws outside a scraper's own error handling.
 */
export async function markSourceError(
  sourceKey: string,
  detail?: string,
  notes?: string | null,
): Promise<void> {
  await recordSourceRun(sourceKey, {
    outcome: "fetch_failed",
    rowCount: 0,
    detail: detail ?? "unhandled exception during scrape",
    notes,
  });
}
