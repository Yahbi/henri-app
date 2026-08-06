/**
 * Reading `get_zip_availability` payloads on the client.
 *
 * Lives here rather than inside the onboarding page because this is where
 * the same bug has now landed twice, and neither time was there a test that
 * could have caught it:
 *
 *   2026-08-04 — both call sites did `available: !data?.is_claimed`. The RPC
 *     has never returned an `is_claimed` key, so the expression was
 *     `!undefined` — a hardcoded `true`. Every ZIP rendered "Available", the
 *     Taken badge and the whole waitlist flow were unreachable, and
 *     contractors were steered into occupied ZIPs that failed at Confirm.
 *
 *   2026-08-06 — the replacement, `slots_used < slots_total`, was correct
 *     for the model in force when it was written and wrong for the one
 *     migration 00135 shipped. Exclusivity is per (zip, trade):
 *     `slots_total` is 10 (the count of trade_type values) and `slots_used`
 *     counts trades taken, so the comparison says "some trade is still
 *     free", not "yours is". A roofer saw "1 of 10 taken" with a green check
 *     on a ZIP whose one roofing slot was gone, and the claim was rejected
 *     with `zip_taken_for_trade` AFTER checkout.
 *
 * The rule this module encodes: `available_for_trade` is the only field that
 * predicts what `claim_territory` will do, and it is TRI-STATE. `null` means
 * the server did not answer the trade question (no trade supplied, or a
 * pre-00137 function still deployed) and must be read as unknown — never
 * coerced into a green check.
 *
 * No imports: this runs in the browser bundle.
 */

/** Per-ZIP availability derived from the get_zip_availability payload. */
export type ZipSlots = {
  /** What the UI gates selection on. Prefers the per-trade verdict. */
  available: boolean;
  /** null when the availability probe failed — NOT the same as 0. */
  slotsUsed: number | null;
  slotsTotal: number | null;
  /** The per-trade answer (migration 00137). null = unknown, not "yes". */
  availableForTrade: boolean | null;
  /** Which trades already hold the ZIP. Trades only — the wedge contract
   *  keeps competitive intel coarse and never identifies a holder. */
  takenTrades: string[];
  /** True when occupancy could not be determined at all. */
  unknown: boolean;
};

/**
 * Fail *closed* on the display: an unknown ZIP is not asserted to be
 * available. Selection is still permitted — claim_territory is the real
 * authority — but the UI must not render a check it cannot back up.
 */
export const UNKNOWN_SLOTS: ZipSlots = {
  available: true,
  slotsUsed: null,
  slotsTotal: null,
  availableForTrade: null,
  takenTrades: [],
  unknown: true,
};

/** Normalise one `/api/territories/[zip]` response body. */
export function readSlots(data: unknown): ZipSlots {
  const d = data as {
    slots_used?: unknown;
    slots_total?: unknown;
    available_for_trade?: unknown;
    taken_trades?: unknown;
  } | null;
  if (!d || typeof d.slots_used !== "number" || typeof d.slots_total !== "number") {
    return UNKNOWN_SLOTS;
  }
  const availableForTrade =
    typeof d.available_for_trade === "boolean" ? d.available_for_trade : null;
  return {
    // The per-trade verdict wins whenever the server gave one. The slot
    // comparison survives only as the fallback for a trade-less caller.
    available: availableForTrade ?? d.slots_used < d.slots_total,
    slotsUsed: d.slots_used,
    slotsTotal: d.slots_total,
    availableForTrade,
    takenTrades: Array.isArray(d.taken_trades)
      ? d.taken_trades.filter((t): t is string => typeof t === "string")
      : [],
    unknown: false,
  };
}

/**
 * One honest sentence about a ZIP's occupancy.
 *
 * Three states, deliberately never collapsed:
 *   unknown              — the probe failed. Say so; don't guess.
 *   per-trade answer     — the only one that predicts what the claim will do.
 *   trade-blind fallback — raw counts, phrased as counts, so the contractor
 *                          can see it is not an answer about their trade.
 *
 * Other-trade occupancy is reported as a NUMBER only. Naming the trades
 * would still stop short of naming the holder, but in a ZIP with one
 * occupant it identifies them to anyone who knows the local market — the
 * wedge contract keeps this coarse for the same reason the "N contractors
 * are watching" count is bucketed.
 */
export function describeSlots(s: ZipSlots, trade: string | null, tradeName: string): string {
  if (s.unknown) return "— couldn't check right now";
  if (s.availableForTrade === false) return `— already taken for ${tradeName}`;
  if (s.availableForTrade === true) {
    const others = otherTradeCount(s, trade);
    return others > 0
      ? `— open for ${tradeName} (${others} other trade${others === 1 ? "" : "s"} claimed here)`
      : `— open for ${tradeName}`;
  }
  return s.available
    ? `— ${s.slotsUsed ?? 0} of ${s.slotsTotal ?? 10} trade slots taken`
    : "— all trade slots taken";
}

/** Trades held in this ZIP other than the caller's own. */
export function otherTradeCount(s: ZipSlots, trade: string | null): number {
  return s.takenTrades.filter((t) => t !== trade).length;
}
