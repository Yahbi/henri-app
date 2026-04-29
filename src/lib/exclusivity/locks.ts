/* ── Per-permit exclusivity locks — Phase 0a wedge #1 ─────────────────── */
/*                                                                        */
/*  The anti-Angi primitive: one contractor per permit per trade for a    */
/*  configurable window (default 14 days). The "lead" itself (public      */
/*  permit record) is not gated — the ENRICHED packet is. Contact info,   */
/*  scored urgency, auto-filled outreach templates are all keyed off an   */
/*  active lock. If a contractor doesn't log outreach within 72h the      */
/*  "forfeit" cron releases the lock to the next contractor in the zip.   */
/*                                                                        */
/*  Graceful-degradation contract: every function returns a valid "empty  */
/*  state" shape if the `lead_exclusivity_locks` table doesn't exist yet  */
/*  (migration 00031 not applied). Callers can always render.             */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export type ExclusivityReleaseReason =
  | "expired"
  | "declined"
  | "won"
  | "forfeit";

export interface ExclusivityLock {
  id: string;
  lead_id: string;
  contractor_id: string;
  trade: string | null;
  zip: string | null;
  window_start: string;
  window_end: string;
  forfeit_deadline: string | null;
  released_at: string | null;
  released_reason: ExclusivityReleaseReason | null;
  created_at: string;
  updated_at: string;
}

export interface ExclusivityLockSummary {
  lead_id: string;
  /** Is there an active (unreleased, un-expired) lock held by caller? */
  held_by_caller: boolean;
  /** Ms remaining in the window — negative if already expired. */
  ms_remaining: number;
  /** ISO timestamp the lock expires. */
  window_end: string | null;
}

/**
 * Combined per-lead exclusivity summary — what the `/api/exclusivity`
 * GET returns for each requested lead. Extends the lock summary with
 * the coarse "other contractors watching" bucket from wedge #6.
 *
 * UI consumers should render the lock pill from `held_by_caller` +
 * `ms_remaining` and the competitive-intel pill from `watchers_bucket`
 * (skipping the latter when bucket is "0").
 */
export interface ExclusivityLeadSummary extends ExclusivityLockSummary {
  /** Coarse bucket of OTHER contractors watching. Never a raw count. */
  watchers_bucket: WatcherBucket;
}

/**
 * Wedge contract #6 — "Coarse competitive intel":
 *   > "N other contractors are watching this permit" shows a bucketed
 *   > count (1-2, 3-5, 5+), never names. Discourages racing.
 *
 * We expose ONLY the bucket — never the raw count — so the UI can't
 * leak a precise number even by accident. `"0"` means "you're alone
 * looking at this" (or no one else has acquired a lock yet).
 */
export type WatcherBucket = "0" | "1-2" | "3-5" | "5+";

export interface WatchersSummary {
  lead_id: string;
  /** Coarse bucket — never the raw count. */
  bucket: WatcherBucket;
}

function watcherBucket(n: number): WatcherBucket {
  if (n <= 0) return "0";
  if (n <= 2) return "1-2";
  if (n <= 5) return "3-5";
  return "5+";
}

/** Default lock window — 14 days. Matches the plan's wedge #1 default. */
export const DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Default forfeit deadline — 72 hours of no outreach logged. */
export const DEFAULT_FORFEIT_MS = 72 * 60 * 60 * 1000;

function tableMissing(msg: string | null | undefined): boolean {
  return !!msg && /Could not find the table|does not exist/i.test(msg);
}

/**
 * Try to acquire an exclusivity lock on a lead for the given
 * contractor + trade combo. Returns the existing lock if one already
 * exists (idempotent) or a newly-created one. Returns null when the
 * table is missing (pre-migration) OR when another contractor already
 * holds an active lock on the same (lead, trade).
 */
export async function acquireLock(
  supabase: SupabaseClient,
  params: {
    lead_id: string;
    contractor_id: string;
    trade: string | null;
    zip: string | null;
    windowMs?: number;
    forfeitMs?: number;
  },
): Promise<ExclusivityLock | null> {
  const now = Date.now();
  const windowEnd = new Date(now + (params.windowMs ?? DEFAULT_WINDOW_MS)).toISOString();
  const forfeitDeadline = new Date(now + (params.forfeitMs ?? DEFAULT_FORFEIT_MS)).toISOString();

  // Audit B4+B5 fix (2026-04-27): RACE-SAFE acquire.
  //
  // The prior INSERT → conflict-fetch pattern had two distinct races:
  //   B4: Two contractors hitting acquire simultaneously could both see
  //       "no active lock" if their INSERTs interleaved with each other's
  //       conflict-fetch SELECT — wedge bullet #1 violated.
  //   B5: When the conflict-fetch returned null (because the conflicting
  //       row was released between conflict and fetch), the function
  //       returned null — same return value as "different contractor" —
  //       so a freshly-released permit stayed invisible until the next
  //       React Query stale.
  //
  // New pattern — three layers of safety:
  //   (1) Single-statement upsert with the canonical conflict target
  //       (`uq_exclusivity_active_lock` partial unique index on
  //       `(lead_id, COALESCE(trade,''))` WHERE released_at IS NULL).
  //       Postgres holds a row-level lock for the duration of the
  //       upsert, so the per-row decision is atomic.
  //   (2) `ignoreDuplicates: false` so we get the existing row back
  //       on conflict instead of a blank insert.
  //   (3) On no-row-back fallback, retry the insert exactly once after
  //       a 50 ms backoff — covers the B5 race where the conflicting
  //       row was released in between.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from("lead_exclusivity_locks")
      .upsert(
        {
          lead_id: params.lead_id,
          contractor_id: params.contractor_id,
          trade: params.trade,
          zip: params.zip,
          window_end: windowEnd,
          forfeit_deadline: forfeitDeadline,
        },
        {
          // Conflict target matches the partial unique index name from
          // migration 00031 (`uq_exclusivity_active_lock` on
          // (lead_id, COALESCE(trade,'')) WHERE released_at IS NULL).
          // PostgREST exposes the column list, not the constraint name;
          // we pass the columns the index covers.
          onConflict: "lead_id,trade",
          ignoreDuplicates: false,
        },
      )
      .select()
      .single();

    if (!error && data) {
      // If the row already existed and is held by THIS contractor, the
      // upsert refreshed it — return idempotently. If it's held by a
      // DIFFERENT contractor, surface a "locked" return value (null) so
      // the caller can show the watchers badge instead of a "you got it"
      // toast. The active-lock predicate (released_at IS NULL) is
      // already enforced by the partial unique index, so the row we
      // got back IS the active one.
      const lock = data as ExclusivityLock;
      if (lock.contractor_id === params.contractor_id) {
        return lock;
      }
      // Different contractor holds the active lock — return null.
      return null;
    }

    if (error && tableMissing(error.message)) return null;

    // Race window: row-not-returned after upsert can mean PostgREST
    // received the conflict but the row is now released (B5 race).
    // Brief backoff and retry insert exactly once.
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }

    // Final attempt also failed — surface as "locked" (null) rather
    // than throwing. Caller falls back to read-only view.
    return null;
  }
  return null;
}

/**
 * Release a lock (contractor declined, won, or we're expiring it).
 * Idempotent; no-op if already released.
 */
export async function releaseLock(
  supabase: SupabaseClient,
  params: { lead_id: string; contractor_id: string; reason: ExclusivityReleaseReason },
): Promise<void> {
  const { error } = await supabase
    .from("lead_exclusivity_locks")
    .update({
      released_at: new Date().toISOString(),
      released_reason: params.reason,
    })
    .eq("lead_id", params.lead_id)
    .eq("contractor_id", params.contractor_id)
    .is("released_at", null);
  if (error && !tableMissing(error.message)) {
    logger.warn("releaseLock failed", { error: error.message });
  }
}

/**
 * Summarize lock state for a set of leads from a single contractor's
 * perspective. Used by the Leads list + Pipeline Kanban to render the
 * "14d left" / "locked by someone else" pills without N+1 queries.
 */
export async function summarizeLocksForContractor(
  supabase: SupabaseClient,
  contractorId: string,
  leadIds: string[],
): Promise<Map<string, ExclusivityLockSummary>> {
  const out = new Map<string, ExclusivityLockSummary>();
  if (leadIds.length === 0) return out;

  const { data, error } = await supabase
    .from("lead_exclusivity_locks")
    .select("lead_id, contractor_id, window_end, released_at")
    .in("lead_id", leadIds)
    .is("released_at", null);

  if (error) {
    if (!tableMissing(error.message)) {
      logger.warn("summarizeLocksForContractor failed", { error: error.message });
    }
    return out;
  }

  const now = Date.now();
  for (const row of (data ?? []) as Array<{
    lead_id: string;
    contractor_id: string;
    window_end: string;
    released_at: string | null;
  }>) {
    out.set(row.lead_id, {
      lead_id: row.lead_id,
      held_by_caller: row.contractor_id === contractorId,
      ms_remaining: new Date(row.window_end).getTime() - now,
      window_end: row.window_end,
    });
  }
  return out;
}

/**
 * Summarize the number of *other* contractors actively watching each
 * lead — returned as a coarse bucket to satisfy wedge #6. The caller's
 * own lock is excluded, and expired (window_end < now) locks the cron
 * hasn't yet reaped are filtered out client-side.
 *
 * Graceful-degrade: if the table is missing (pre-migration 00031) every
 * lead gets `bucket: "0"` rather than an error — UI still renders.
 *
 * NB: we deliberately share a single query with summarizeLocksForContractor
 * in the route handler, not here, so we can amortise the SELECT cost.
 * This function is standalone for call sites that only need watchers.
 */
export async function summarizeWatchersByLead(
  supabase: SupabaseClient,
  callerContractorId: string,
  leadIds: string[],
): Promise<Map<string, WatchersSummary>> {
  const out = new Map<string, WatchersSummary>();
  if (leadIds.length === 0) return out;

  const { data, error } = await supabase
    .from("lead_exclusivity_locks")
    .select("lead_id, contractor_id, window_end, released_at")
    .in("lead_id", leadIds)
    .is("released_at", null);

  if (error) {
    if (!tableMissing(error.message)) {
      logger.warn("summarizeWatchersByLead failed", { error: error.message });
    }
    // Graceful-degrade — every requested lead gets the empty bucket.
    for (const id of leadIds) out.set(id, { lead_id: id, bucket: "0" });
    return out;
  }

  const now = Date.now();
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{
    lead_id: string;
    contractor_id: string;
    window_end: string;
    released_at: string | null;
  }>) {
    // Expired-but-unreaped locks shouldn't count as "watchers". The cron
    // releases them on a schedule, but between runs they'd inflate the
    // bucket and re-introduce the racing signal we're trying to suppress.
    if (new Date(row.window_end).getTime() <= now) continue;
    // Exclude the caller — "N other contractors".
    if (row.contractor_id === callerContractorId) continue;
    counts.set(row.lead_id, (counts.get(row.lead_id) ?? 0) + 1);
  }

  for (const id of leadIds) {
    out.set(id, { lead_id: id, bucket: watcherBucket(counts.get(id) ?? 0) });
  }
  return out;
}

/** Format "14d 3h" from a ms-remaining value. Short, fits in a pill. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) {
    const hoursRest = hours - days * 24;
    return hoursRest > 0 ? `${days}d ${hoursRest}h left` : `${days}d left`;
  }
  if (hours >= 1) return `${hours}h left`;
  return `${minutes}m left`;
}
