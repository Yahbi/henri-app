/**
 * Per-source pagination cursor for /api/cron/parcels-sidecar.
 *
 * Same problem and same solution as lib/scrapers/cursor.ts, which this
 * deliberately mirrors rather than reinvents.
 *
 * THE PROBLEM
 * -----------
 * A registered parcel feed is large — WV-PARCEL-SUMMARY reports 1,394,081
 * rows and NC-ONEMAP-STATEWIDE 5,938,901 — while one cron invocation has a
 * few minutes of wall clock. Without a cursor every run restarts at offset 0,
 * so the loader would re-read and re-upsert the same first pages forever and
 * the tail of every feed would be permanently unreachable. Running the cron
 * more often would make that worse, not better.
 *
 * WHERE IT LIVES
 * --------------
 * `parcel_sources` has no spare integer column (source_key .. updated_at are
 * all occupied) and adding one needs a migration. `notes` is the only
 * free-text column, and the established in-repo pattern is to keep a
 * delimited machine block inside it:
 *
 *   [henri:parcel-cursor] offset=25000 at=2026-08-07T09:00:00.000Z [/henri:parcel-cursor]
 *
 * O(1) storage, read for free with the source row, and written by the same
 * UPDATE that already stamps `last_run_at` — no extra round trip. Operator
 * prose in `notes` survives verbatim (see `spliceBlock`).
 *
 * The delimiters are distinct from the scrape cursor's, so the two never
 * collide even though both use `spliceBlock`.
 *
 * Reaching the end of a feed REMOVES the block rather than storing a zero, so
 * "absent == start from the beginning" is the only rule a reader needs, and a
 * completed feed wraps and re-reads for upstream changes on its next turn.
 */

import { readBlock, spliceBlock } from "@/lib/scrapers/types";

export const PARCEL_CURSOR_OPEN = "[henri:parcel-cursor]";
export const PARCEL_CURSOR_CLOSE = "[/henri:parcel-cursor]";

/** cron_runs path used for this cron's audit rows. */
export const PARCELS_CRON_PATH = "parcels-sidecar";

/**
 * Read the resume offset out of a source's `notes`.
 *
 * Returns 0 for absent, malformed or non-positive values. A lost cursor only
 * costs a re-read of the first page — never correctness, because every write
 * is an upsert on (state_code, source_parcel_id).
 */
export function readParcelCursor(notes: string | null | undefined): number {
  const body = readBlock(notes ?? null, PARCEL_CURSOR_OPEN, PARCEL_CURSOR_CLOSE);
  if (!body) return 0;
  const m = body.match(/offset=(\d+)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Timestamp of the last cursor write, for operator forensics. Null if absent. */
export function readParcelCursorUpdatedAt(notes: string | null | undefined): string | null {
  const body = readBlock(notes ?? null, PARCEL_CURSOR_OPEN, PARCEL_CURSOR_CLOSE);
  if (!body) return null;
  const m = body.match(/at=(\S+)/);
  return m ? m[1] : null;
}

/**
 * Write (or clear) the resume offset in a source's `notes`.
 *
 * `offset <= 0` means the feed was exhausted and the next run should wrap
 * back to the start — the block is removed entirely.
 */
export function writeParcelCursor(
  notes: string | null | undefined,
  offset: number,
  now: Date = new Date(),
): string {
  const clean = Number.isFinite(offset) ? Math.floor(offset) : 0;
  if (clean <= 0) {
    return spliceBlock(notes ?? null, PARCEL_CURSOR_OPEN, PARCEL_CURSOR_CLOSE, null);
  }
  return spliceBlock(
    notes ?? null,
    PARCEL_CURSOR_OPEN,
    PARCEL_CURSOR_CLOSE,
    `offset=${clean} at=${now.toISOString()}`,
  );
}
