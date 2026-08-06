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

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

/**
 * `permit_sources.dataset_kind` — see migration 00122.
 *
 * 'permit' means "a sample payload passed the non-permit screen", NOT
 * "a human confirmed this is a permit feed". Keep the two apart: the whole
 * point of the column is that the classification is EVIDENCE, and overstating
 * it would make the registry lie in the other direction.
 */
export type DatasetKind = "unknown" | "permit" | "non_permit";
export const NON_PERMIT_KIND: DatasetKind = "non_permit";

/**
 * Tri-state cache for "does this DB have migration 00122 applied?".
 *
 * `null` = untested. Per CLAUDE.md's feature-flag rule every new column ships
 * with a graceful-degrade read path, and adding an unknown column to a SELECT
 * or a filter breaks the WHOLE query — so the first query that touches
 * `dataset_kind` optimistically includes it, and on SQLSTATE 42703 flips this
 * flag and retries without. One wasted round trip per process, ever.
 */
let datasetKindColumnSupported: boolean | null = null;

export function datasetKindSupported(): boolean | null {
  return datasetKindColumnSupported;
}

export function setDatasetKindSupported(value: boolean): void {
  if (datasetKindColumnSupported !== value) {
    logger.info("sources-db.dataset_kind_support", { supported: value });
  }
  datasetKindColumnSupported = value;
}

/** Test seam — the cache is module state, so suites must be able to clear it. */
export function __resetDatasetKindSupport(): void {
  datasetKindColumnSupported = null;
}

/**
 * True when a PostgREST error means "that column does not exist".
 *
 * Postgres raises 42703 (undefined_column); PostgREST forwards the code, but
 * older versions surfaced only the message, hence the belt-and-braces text
 * match. Pure + exported for unit tests.
 */
export function isUndefinedColumnError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

interface QueryResponse<T> {
  data: T[] | null;
  error: { code?: string | null; message: string } | null;
}

/**
 * Run a query that filters on `dataset_kind`, falling back to the unfiltered
 * form when the column is absent.
 *
 * The callback takes the flag rather than a pre-built query so the retry can
 * rebuild from scratch — a PostgREST builder is single-use.
 */
async function withDatasetKindFallback<T>(
  run: (useDatasetKind: boolean) => PromiseLike<QueryResponse<T>>,
): Promise<QueryResponse<T>> {
  const attempt = datasetKindColumnSupported !== false;
  const res = await run(attempt);
  if (attempt && res.error && isUndefinedColumnError(res.error)) {
    setDatasetKindSupported(false);
    return run(false);
  }
  if (attempt && !res.error) setDatasetKindSupported(true);
  return res;
}

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
  /**
   * Rows this source produced on its last healthy run; NULL when it has never
   * run. This is the producer/explorer discriminator the lanes split on, and
   * it is carried through to the caller so /api/cron/scrape can spend a cheap
   * FIRST-TOUCH page on an unproven source instead of the full backfill
   * allowance. Deep-paginating a source whose field mapping is still a guess
   * costs the run's budget AND writes thousands of rows that may be garbage.
   */
  lastCount: number | null;
}

const SOURCE_COLUMNS =
  "source_key, city, jurisdiction, state, endpoint, source_type, auth, update_freq, layer_index, id_field, type_field, status_field, desc_field, address_field, date_field, value_field, lat_field, lng_field, enabled, notes, last_count";

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
    lastCount: row.last_count == null ? null : Number(row.last_count),
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

/**
 * Lane A: proven producers (last_count > 0), highest priority + oldest first.
 * Lane B: never-produced explorers (NULL or 0 last_count).
 *
 * `useDatasetKind` adds the registry-level exclusion of sources a probe has
 * already proved are NOT permit feeds. Without it those rows keep scraping
 * business-licence / utility rows into `permits` until the 10-strike
 * auto-disable happens to catch them — ten wasted runs each, and ten runs of
 * inflated permit counts.
 */
function lane(
  supabase: SupabaseAdmin,
  opts: { producers: boolean; limit: number; useDatasetKind: boolean },
) {
  let q = supabase
    .from("permit_sources")
    .select(SOURCE_COLUMNS)
    .eq("enabled", true);
  q = opts.producers
    ? q.gt("last_count", 0)
    : q.or("last_count.is.null,last_count.eq.0");
  if (opts.useDatasetKind) q = q.neq("dataset_kind", NON_PERMIT_KIND);
  return q
    .order("priority", { ascending: false })
    .order("last_scraped_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit) as unknown as PromiseLike<QueryResponse<SourceRow>>;
}

/**
 * Share of each run's slots reserved for proven producers.
 *
 * Lowered 0.6 -> 0.35 on 2026-08-06 after the weave went live and the real
 * numbers came in. The pools are wildly asymmetric — 28,010 producers against
 * 211,887 explorers, and only 44 sources had EVER produced recently — so
 * spending 60% of every run re-reading a handful of known feeds was the wrong
 * trade once the explorer lane could be reached at all. First measured run
 * after the weave: 24 sources, of which only 7 were new.
 *
 * Freshness does not suffer. At 0.35 the producer lane still gets ~10 slots
 * per run x 24 runs/day across 44 active producers, so each is scraped
 * several times a day, and every one of those runs does a HEAD pass first
 * (offset 0 = newest). Permits filed this morning still land today.
 *
 * Revisit when the producer pool grows: once thousands of sources are
 * genuinely producing, they will need a larger share to stay fresh.
 */
export const PRODUCER_SHARE = 0.35;

/**
 * Interleave the two lanes so the producer/explorer ratio holds at EVERY
 * prefix of the result, not just at the end.
 *
 * This is the whole fix. The previous form was
 *
 *     [...producers, ...explorers].slice(0, limit)
 *
 * which puts all 30 producers at indices 0-29 and every explorer at 30+.
 * `getActiveSources` is called with limit=50, but /api/cron/scrape processes
 * in batches of 5 against a 175s budget and reaches roughly the first 15
 * sources — so indices 15-49 were never read, and the explorer lane received
 * ZERO slots on any run where 15+ producers existed. 28,010 do.
 *
 * That closed a loop rather than merely slowing one down: a source is an
 * explorer until it earns `last_count > 0`, it can only earn that by being
 * scraped, and it could only be scraped from a slot it was never given.
 * Measured on production 2026-08-06 — of 239,897 enabled sources, 210,903 had
 * NEVER been scraped, and exactly 44 had been scraped in the preceding 30
 * days: the same 44 every run, deep-paginating their own history. The 60/40
 * split was nominal; the effective split was 100/0. `activate-arcgis-sources`
 * enabling 50 new sources a day fed a queue nothing could ever leave.
 *
 * Weaving makes the cutoff harmless. Because the ratio is enforced against
 * the running output length, any prefix is already balanced — the first 15
 * slots carry ~9 producers and ~6 explorers, and so would the first 8 or the
 * first 30. The budget can stop wherever it likes and new sources still get
 * scraped. Whichever lane runs dry first, the other fills the remainder, so a
 * short lane costs throughput but never a slot.
 */
function weaveLanes<T>(producers: T[], explorers: T[], limit: number): T[] {
  const out: T[] = [];
  let p = 0;
  let e = 0;

  while (out.length < limit && (p < producers.length || e < explorers.length)) {
    // How many producers SHOULD have appeared once this slot is filled.
    //
    // ceil, not round. At PRODUCER_SHARE = 0.35 rounding gives a quota of 0
    // for the first slot, so slot 0 would go to an explorer — and slot 0 is
    // exactly where the priority-10 hand-verified feeds live, since both
    // lanes sort priority DESC. ceil guarantees the run always opens with a
    // producer while still converging on the share across the whole list
    // (ceil(20 * 0.35) = 7 of 20).
    const producerQuota = Math.ceil((out.length + 1) * PRODUCER_SHARE);
    const wantProducer = p < producerQuota;

    if (wantProducer && p < producers.length) out.push(producers[p++]);
    else if (e < explorers.length) out.push(explorers[e++]);
    else if (p < producers.length) out.push(producers[p++]);
    else break;
  }

  return out;
}

export async function getActiveSources(limit = 50): Promise<DBPermitSource[]> {
  const supabase = createAdminClient();

  // Both lanes fetch the full limit. Fetching only `limit * 0.6` producers
  // would cap the weave's ability to backfill from the producer lane when the
  // explorer lane is short, and the query cost is the same order either way.
  //
  // priority DESC first in BOTH lanes so human-verified / high-value
  // sources (priority=10, e.g. the Tampa territory feed + GOLD contact
  // feeds) always scrape before the long tail, then last_scraped_at
  // rotates within each priority band. NULLS FIRST on last_scraped_at is
  // what walks the never-scraped backlog: `recordSourceRun` stamps the
  // column on BOTH the success and the failure path, so a source leaves the
  // NULL block after exactly one attempt and the queue always advances.
  const [producersRes, explorersRes] = await Promise.all([
    withDatasetKindFallback((useDatasetKind) =>
      lane(supabase, { producers: true, limit, useDatasetKind }),
    ),
    withDatasetKindFallback((useDatasetKind) =>
      lane(supabase, { producers: false, limit, useDatasetKind }),
    ),
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
  const seen = new Set(producers.map((r) => String(r.source_key ?? "")));
  const explorers = (explorersRes.data ?? []).filter(
    (r) => !seen.has(String(r.source_key ?? "")),
  );

  return weaveLanes(producers, explorers, limit).map((row) => toDBPermitSource(row));
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

/**
 * Priority value meaning "reach this unproven source sooner".
 *
 * Both lanes order `priority DESC, last_scraped_at ASC NULLS FIRST`, so this
 * is how a source in a state with no permit coverage jumps the ~210k
 * never-scraped queue instead of waiting out a full rotation. Set in bulk by
 * scripts/prioritize-coverage-gaps.mjs against the states that are actually
 * empty, recomputed from live counts rather than hardcoded.
 *
 * Deliberately 1, not 10: 10 is the hand-set operator value for verified
 * high-value feeds (the Tampa territory feed, the GOLD contact feeds) and must
 * stay strictly above an automated boost.
 *
 * The boost is CONSUMED on the first healthy run — see recordSourceRun. A
 * permanent boost would recreate the starvation it exists to fix.
 */
export const DISCOVERY_BOOST_PRIORITY = 1;

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
        .select("field_mapping_status, priority")
        .eq("source_key", sourceKey)
        .maybeSingle();
      if (record.outcome === "ok" && current?.field_mapping_status === "failed") {
        update.field_mapping_status = "probed";
      }

      // Spend the discovery boost. See DISCOVERY_BOOST_PRIORITY — the boost
      // buys a source its FIRST look, nothing more. Leaving it in place would
      // rebuild the lock it was created to break: both lanes order by
      // `priority DESC` before `last_scraped_at`, so thousands of graduated
      // boosted sources would form a permanent front rank and starve the
      // priority-0 producers that carry today's ingest. Reset on the first
      // healthy run, and only from the boost value — hand-set operator
      // priorities (10) are never touched.
      if (
        record.outcome === "ok" &&
        Number(current?.priority ?? 0) === DISCOVERY_BOOST_PRIORITY
      ) {
        update.priority = 0;
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
    };
    // `enabled` is written on ONE path only: the strike limit. The previous
    // form was `enabled: newCount < MAX_CONSECUTIVE_ERRORS`, which writes
    // `true` for strikes 1-9 — so recording a FAILURE against an already
    // disabled source RESURRECTED it. That reaches two live paths: a source
    // the operator disabled by hand, and (since the activation probe gate)
    // a source we deliberately refused to enable. A failure must never be
    // able to turn a source on.
    if (newCount >= MAX_CONSECUTIVE_ERRORS) update.enabled = false;

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
 * Enable sources whose activation probe found permit-shaped data.
 *
 * Bulk single statement — an activation run enables up to 50 rows and the
 * instance this runs against is not always healthy enough for 50 round trips.
 *
 * Returns the number of rows the update targeted (0 on failure), so the caller
 * never reports an activation that did not happen.
 */
export async function activateProbedSources(sourceKeys: string[]): Promise<number> {
  if (sourceKeys.length === 0) return 0;
  const supabase = createAdminClient();
  const checkedAt = new Date().toISOString();

  const res = await withDatasetKindFallback<never>((useDatasetKind) => {
    const patch: Record<string, unknown> = { enabled: true };
    if (useDatasetKind) {
      patch.dataset_kind = "permit" satisfies DatasetKind;
      patch.dataset_kind_reason = null;
      patch.dataset_kind_checked_at = checkedAt;
    }
    return supabase
      .from("permit_sources")
      .update(patch)
      .in("source_key", sourceKeys) as unknown as PromiseLike<QueryResponse<never>>;
  });

  if (res.error) {
    logger.error("sources-db.activate_failed", {
      error: res.error.message,
      count: sourceKeys.length,
    });
    return 0;
  }
  return sourceKeys.length;
}

/**
 * Record that a source is NOT a permit feed, and keep it disabled.
 *
 * Writes the evidence twice on purpose:
 *   - `dataset_kind` + `dataset_kind_reason` so the decision is queryable and
 *     is never re-derived by another heuristic pass;
 *   - the standard `[henri:scrape-diagnostic]` block in `notes`, which is
 *     where an operator already looks and which survives a DB without
 *     migration 00122 applied.
 *
 * `enabled: false` is written explicitly rather than assumed: the row is
 * already disabled today, but stating it makes the refusal durable against a
 * concurrent activation run.
 *
 * Never throws — a bookkeeping failure must not abort the cron.
 */
export async function rejectProbedSource(
  sourceKey: string,
  params: { reason: string; observedKeys?: string[]; notes?: string | null },
): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date();
  const diagnostic = withDiagnostic(
    params.notes ?? null,
    buildMappingDiagnostic({
      outcome: "unsupported",
      fetched: 1,
      mapped: 0,
      usable: 0,
      observedKeys: params.observedKeys ?? [],
      configured: { activation_probe: "arcgis" },
      detail: params.reason,
      at: now,
    }),
  );

  try {
    const res = await withDatasetKindFallback<never>((useDatasetKind) => {
      const patch: Record<string, unknown> = {
        enabled: false,
        notes: diagnostic,
      };
      if (useDatasetKind) {
        patch.dataset_kind = NON_PERMIT_KIND;
        patch.dataset_kind_reason = params.reason;
        patch.dataset_kind_checked_at = now.toISOString();
      }
      return supabase
        .from("permit_sources")
        .update(patch)
        .eq("source_key", sourceKey) as unknown as PromiseLike<QueryResponse<never>>;
    });
    if (res.error) {
      logger.warn("sources-db.reject_probe_failed", {
        source_key: sourceKey,
        error: res.error.message,
      });
    }
  } catch (err) {
    logger.warn("sources-db.reject_probe_failed", {
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
