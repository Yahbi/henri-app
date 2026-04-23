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

  // Try insert — unique partial index enforces "at most one active lock
  // per (lead, trade)". On conflict: fetch the existing row and return
  // it only if it's held by this same contractor (idempotent).
  const { data, error } = await supabase
    .from("lead_exclusivity_locks")
    .insert({
      lead_id: params.lead_id,
      contractor_id: params.contractor_id,
      trade: params.trade,
      zip: params.zip,
      window_end: windowEnd,
      forfeit_deadline: forfeitDeadline,
    })
    .select()
    .single();

  if (!error) return data as ExclusivityLock;
  if (tableMissing(error.message)) return null;

  // Conflict on unique index — fetch the active lock and see who holds it.
  const { data: existing } = await supabase
    .from("lead_exclusivity_locks")
    .select("*")
    .eq("lead_id", params.lead_id)
    .is("released_at", null)
    .limit(1)
    .maybeSingle();

  if (!existing) return null;
  // Same contractor? Return the existing lock (idempotent). Different
  // contractor? Return null so the caller can surface "lead is locked".
  return (existing as ExclusivityLock).contractor_id === params.contractor_id
    ? (existing as ExclusivityLock)
    : null;
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
    console.warn("releaseLock failed:", error.message);
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
      console.warn("summarizeLocksForContractor failed:", error.message);
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
