import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { TerritoryClaimResult, ZipAvailability } from "@/types/leads";
import { isTradeType, type TradeType } from "@/lib/territory/trades";

/**
 * What `get_zip_availability(p_zip, p_trade)` returns as of migration 00137.
 *
 * `ZipAvailability` in src/types/leads.ts still describes the pre-00137
 * payload. Rather than widen the shared type (and every unrelated consumer
 * of it), the two per-trade keys are added here, where the RPC is actually
 * called.
 *
 *   taken_trades        — which trades already hold this ZIP. Trades only:
 *                         the wedge contract keeps competitive intel coarse
 *                         and never identifies a holder.
 *   available_for_trade — the direct answer to "can THIS contractor claim
 *                         it". `null` when no trade was supplied, which is
 *                         NOT the same as `true` — callers must treat null
 *                         as "unknown" and fall back to the slot counts.
 */
export type ZipAvailabilityForTrade = ZipAvailability & {
  taken_trades: string[];
  available_for_trade: boolean | null;
};

/**
 * Turn a `claim_territory` RAISE into something a contractor can act on.
 *
 * The RPC's messages are written for operators and carry a machine prefix
 * (`payment_required:`, `tier_cap_exceeded:`, `zip_taken_for_trade:`). They
 * were being returned to the browser verbatim, so a contractor blocked at
 * checkout read "payment_required: complete checkout to claim territories".
 *
 * Anything unrecognised is passed through unchanged rather than replaced with
 * a generic apology — an unexpected message the contractor can quote to
 * support beats a friendly one that says nothing.
 */
function humanizeClaimError(message: string, zip: string): string {
  if (message.includes("zip_taken_for_trade")) {
    // Deliberately does not name the holder. The wedge contract keeps
    // competitive intel coarse — "N other contractors are watching" is
    // bucketed and never named, and this must not become the back door.
    return `${zip} is already taken for your trade. Another trade in this ZIP may still be available.`;
  }
  if (message.includes("payment_required")) {
    return "Add a payment method to claim territories.";
  }
  if (message.includes("tier_cap_exceeded")) {
    // The RPC's text already carries the plan name and both counts, which is
    // exactly what the contractor needs; only the prefix is noise.
    return message.replace(/^tier_cap_exceeded:\s*/, "");
  }
  if (message.includes("already holds an active territory")) {
    return `You already hold ${zip}.`;
  }
  if (message.includes("slots are taken")) {
    return `${zip} is fully allocated.`;
  }
  return message;
}

export async function claimTerritory(
  zip: string,
  contractorId: string
): Promise<TerritoryClaimResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("claim_territory", {
    p_zip: zip,
    p_contractor_id: contractorId,
  });

  if (error) {
    // Logged raw so the operator keeps the prefix + full detail that the
    // contractor-facing string drops.
    logger.warn("territory.claim_rejected", { zip, contractorId, error: error.message });
    return { success: false, message: humanizeClaimError(error.message, zip) };
  }

  return {
    success: data?.success ?? true,
    message: data?.message ?? `Territory ${zip} claimed successfully`,
  };
}

export async function releaseTerritory(
  zip: string,
  contractorId: string
): Promise<TerritoryClaimResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("release_territory", {
    p_zip: zip,
    p_contractor_id: contractorId,
  });

  if (error) {
    return { success: false, message: error.message };
  }

  return {
    success: data?.success ?? true,
    message: data?.message ?? `Territory ${zip} released successfully`,
  };
}

/** Attempts at allocating a free `position` before giving up. Only a
 *  concurrent joiner on the SAME ZIP can collide, so two retries is
 *  generous; the loop exists so a collision surfaces as a retry rather
 *  than as a hard error the contractor cannot act on. */
const WAITLIST_POSITION_ATTEMPTS = 3;

/** Does this unique violation come from the one-row-per-contractor index
 *  (a genuine "you're already on it") rather than the position index? */
function isDuplicateContractor(err: { message?: string; details?: string | null }): boolean {
  const haystack = `${err.message ?? ""} ${err.details ?? ""}`;
  return /uq_zip_waitlist_contractor|\(zip, ?contractor_id\)/i.test(haystack);
}

/**
 * Join the waitlist for a ZIP that is taken for the caller's trade.
 *
 * Until 2026-08-06 this inserted `created_at` — a column `zip_waitlist` has
 * never had (see supabase/migrations/00003_territories.sql:58-64) — and
 * omitted `position`, which is NOT NULL with no default. PostgREST rejected
 * every call with PGRST204 before Postgres could even reach the NOT NULL,
 * so the code never returned 23505 and the friendly duplicate branch below
 * was unreachable. The route turned the raw driver message into a 409 and
 * the button rendered "Retry waitlist" forever.
 *
 * It went unnoticed because the button was itself unreachable: joining is
 * only offered for a ZIP the picker calls taken, and under the old
 * trade-blind availability check that required all ten slots in one ZIP.
 * Fixing the per-trade check (same change) makes this path routine.
 *
 * `joined_at` is deliberately not supplied — the column defaults to now()
 * and the database clock is the one that should order a queue.
 *
 * `position` is allocated read-then-insert rather than in SQL, because
 * PostgREST cannot express `INSERT ... SELECT max(position)+1`. Two
 * concurrent joiners can therefore pick the same number; that collides on
 * uq_zip_waitlist_position and is retried here. Moving the whole insert
 * into a SECURITY DEFINER function would make it atomic and is the better
 * long-term shape — it needs a migration, so it is deliberately not bundled
 * into this fix.
 */
export async function joinWaitlist(
  zip: string,
  contractorId: string
): Promise<TerritoryClaimResult> {
  const supabase = createAdminClient();

  for (let attempt = 0; attempt < WAITLIST_POSITION_ATTEMPTS; attempt++) {
    const { data: tail, error: tailError } = await supabase
      .from("zip_waitlist")
      .select("position")
      .eq("zip", zip)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tailError) {
      logger.warn("waitlist.position_probe_failed", { zip, error: tailError.message });
      return { success: false, message: tailError.message };
    }

    const position = (tail?.position ?? 0) + 1 + attempt;

    const { error } = await supabase.from("zip_waitlist").insert({
      zip,
      contractor_id: contractorId,
      position,
    });

    if (!error) {
      return {
        success: true,
        message: `Added to waitlist for ZIP ${zip} at position ${position}`,
      };
    }

    if (error.code === "23505" && isDuplicateContractor(error)) {
      return { success: false, message: "Already on the waitlist for this ZIP" };
    }

    if (error.code === "23505") {
      // Position taken by a concurrent joiner — re-read and try the next one.
      logger.warn("waitlist.position_collision", { zip, position, attempt });
      continue;
    }

    // Anything else (missing column, RLS, connectivity) is a real failure
    // and must NOT be reported as the friendly duplicate message — that is
    // exactly how the broken insert above stayed invisible.
    logger.error("waitlist.insert_failed", { zip, error: error.message, code: error.code });
    return { success: false, message: error.message };
  }

  return {
    success: false,
    message: "Couldn't reserve a waitlist position right now. Please try again.",
  };
}

/**
 * Read ZIP occupancy, optionally answering "can a {trade} contractor claim
 * this?" as well.
 *
 * `trade` is optional so the unauthenticated availability widget keeps
 * working: with no trade the RPC's `p_trade` binds to its DEFAULT NULL and
 * `available_for_trade` comes back null, which callers must read as
 * "unknown" rather than "yes".
 */
export async function getZipAvailability(
  zip: string,
  trade?: TradeType | null
): Promise<ZipAvailabilityForTrade | null> {
  const supabase = createAdminClient();

  // Guard the enum here as well as at the edge: `p_trade` is typed
  // `public.trade_type`, so an unknown label is a Postgres cast error, not
  // a null result.
  const p_trade = isTradeType(trade) ? trade : null;

  const { data, error } = await supabase.rpc("get_zip_availability", {
    p_zip: zip,
    p_trade,
  });

  if (error) {
    logger.error("Error checking zip availability", { error: error.message });
    return null;
  }

  // Validate the shape instead of asserting it. The blind
  // `data as ZipAvailability` cast here is what let a wrong interface
  // (which claimed an `is_claimed` field the RPC never returns) survive
  // typechecking and silently break the onboarding availability check.
  const raw = data as Partial<ZipAvailabilityForTrade> | null;
  if (!raw || typeof raw.slots_used !== "number" || typeof raw.slots_total !== "number") {
    logger.error("get_zip_availability returned an unexpected shape", {
      zip,
      keys: raw ? Object.keys(raw).join(",") : "null",
    });
    return null;
  }

  return {
    zip: raw.zip ?? zip,
    slots_used: raw.slots_used,
    slots_total: raw.slots_total,
    contractors: raw.contractors ?? [],
    waitlist_count: raw.waitlist_count ?? 0,
    // Only trade LABELS, never holders. Anything non-string is dropped
    // rather than rendered.
    taken_trades: Array.isArray(raw.taken_trades)
      ? raw.taken_trades.filter((t): t is string => typeof t === "string")
      : [],
    // Tri-state on purpose. `undefined` (an older function still deployed)
    // and `null` (no trade supplied) both mean "unknown", and the UI must
    // not turn either into a green check.
    available_for_trade:
      typeof raw.available_for_trade === "boolean" ? raw.available_for_trade : null,
  };
}
