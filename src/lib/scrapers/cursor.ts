/**
 * Per-source pagination cursor for /api/cron/scrape.
 *
 * THE BUG THIS CLOSES
 * -------------------
 * Both scrapers started every run at `offset = 0` and paged at most 20 x 1000
 * rows. That is a hard 20,000-row ceiling PER SOURCE, FOREVER — not per run.
 * Fort Worth (~1.6M permits) and Kansas City (~1.5M) re-ingested the same
 * newest 20k rows every hour and could never reach row 20,001. Running the
 * cron more often made it worse, not better.
 *
 * A cursor that survives between runs turns the same 20k/run budget into a
 * walk through the whole feed.
 *
 * WHERE THE CURSOR LIVES
 * ----------------------
 * `permit_sources` has no spare int/jsonb column (checked: id .. notes, all
 * occupied) and adding one needs a migration. The in-repo precedent —
 * /api/cron/nj-statewide-permits stashing `nextOffset` in
 * `cron_runs.summary` — works for ONE source but does not scale to a
 * 50-source rotation: the map would have to carry every source that has not
 * yet reached end-of-feed (661 sources today, source_key up to 185 chars),
 * i.e. a ~130KB jsonb blob written 24x/day = ~90MB/month of audit table on a
 * Supabase Free tier that has already hit disk-full once.
 *
 * So the cursor is stored PER SOURCE, in a delimited machine block inside
 * `permit_sources.notes`:
 *
 *     [henri:scrape-cursor] offset=20000 at=2026-08-04T12:00:00.000Z [/henri:scrape-cursor]
 *
 * That is O(1) storage, is read for free with the source row, and is written
 * by the UPDATE `recordSourceRun` already performs — no extra round trips.
 * Operator prose in `notes` is preserved verbatim (see `spliceBlock`).
 *
 * Reaching the end of a feed REMOVES the block rather than storing a zero, so
 * "absent == start from the newest rows" is the single rule readers need.
 */

import { readBlock, spliceBlock } from "./types";

export const CURSOR_OPEN = "[henri:scrape-cursor]";
export const CURSOR_CLOSE = "[/henri:scrape-cursor]";

/** cron_runs path used for the scrape cron's own audit row. */
export const SCRAPE_CRON_PATH = "scrape";

/**
 * Read the resume offset out of a source's `notes`.
 *
 * Returns 0 (start from the top of the feed) for absent, malformed, or
 * non-positive values — a lost cursor only costs us re-reading the newest
 * page, never correctness, because every write is an upsert.
 *
 * Pure + unit-testable.
 */
export function readCursor(notes: string | null | undefined): number {
  const body = readBlock(notes ?? null, CURSOR_OPEN, CURSOR_CLOSE);
  if (!body) return 0;
  const m = body.match(/offset=(\d+)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Timestamp of the last cursor write, for operator forensics. Null if absent. */
export function readCursorUpdatedAt(notes: string | null | undefined): string | null {
  const body = readBlock(notes ?? null, CURSOR_OPEN, CURSOR_CLOSE);
  if (!body) return null;
  const m = body.match(/at=(\S+)/);
  return m ? m[1] : null;
}

/**
 * Write (or clear) the resume offset in a source's `notes`.
 *
 * `offset <= 0` means the feed was exhausted and the next run should wrap to
 * the newest rows — the block is removed entirely.
 *
 * Pure + unit-testable.
 */
export function writeCursor(
  notes: string | null | undefined,
  offset: number,
  now: Date = new Date(),
): string {
  const clean = Number.isFinite(offset) ? Math.floor(offset) : 0;
  if (clean <= 0) return spliceBlock(notes ?? null, CURSOR_OPEN, CURSOR_CLOSE, null);
  return spliceBlock(
    notes ?? null,
    CURSOR_OPEN,
    CURSOR_CLOSE,
    `offset=${clean} at=${now.toISOString()}`,
  );
}
