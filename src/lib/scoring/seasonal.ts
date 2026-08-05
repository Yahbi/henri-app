/* ── Seasonal multipliers by trade and month ─────────────────────────────── */
/*  Each array is indexed 0-11 (Jan-Dec). Values range 0.5-1.5.             */
/*  A factor > 1.0 means peak season (more demand, faster close rates).      */
/*  A factor < 1.0 means off-season (slower demand, longer sales cycles).    */
/* ───────────────────────────────────────────────────────────────────────── */

//                          Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
const SEASONAL_FACTORS: Record<string, number[]> = {
  roofing:          [0.6, 0.7, 0.9, 1.2, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.7, 0.5],
  hvac:             [1.3, 1.2, 0.9, 0.8, 1.0, 1.4, 1.5, 1.4, 1.0, 0.8, 1.0, 1.3],
  plumbing:         [1.1, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.9, 1.0, 1.0, 1.1, 1.2],
  electrical:       [0.9, 0.9, 1.0, 1.1, 1.1, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9],
  solar:            [0.7, 0.8, 1.0, 1.2, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.7, 0.6],
  painting:         [0.5, 0.6, 0.9, 1.2, 1.3, 1.4, 1.3, 1.2, 1.1, 1.0, 0.7, 0.5],
  landscaping:      [0.5, 0.6, 1.0, 1.3, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.6, 0.5],
  concrete:         [0.6, 0.7, 0.9, 1.1, 1.3, 1.3, 1.2, 1.1, 1.0, 0.9, 0.7, 0.5],
  fencing:          [0.6, 0.7, 1.0, 1.2, 1.3, 1.2, 1.1, 1.1, 1.0, 0.9, 0.7, 0.6],
  flooring:         [1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.9, 0.9, 1.0, 1.1, 1.1, 1.0],
  windows:          [0.7, 0.8, 1.0, 1.1, 1.2, 1.1, 1.0, 1.0, 1.1, 1.1, 0.8, 0.7],
  siding:           [0.6, 0.7, 0.9, 1.1, 1.3, 1.3, 1.2, 1.1, 1.0, 0.9, 0.7, 0.5],
  insulation:       [1.2, 1.1, 0.9, 0.8, 0.8, 0.7, 0.7, 0.8, 0.9, 1.0, 1.2, 1.3],
  demolition:       [0.7, 0.8, 1.0, 1.1, 1.2, 1.2, 1.1, 1.1, 1.0, 0.9, 0.8, 0.7],
  "general remodel":[0.8, 0.8, 0.9, 1.1, 1.2, 1.1, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8],
  general:          [0.9, 0.9, 1.0, 1.1, 1.1, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.9],
  kitchen:          [0.9, 1.0, 1.1, 1.1, 1.0, 0.9, 0.9, 0.9, 1.0, 1.1, 1.1, 0.9],
  bathroom:         [0.9, 1.0, 1.1, 1.1, 1.0, 0.9, 0.9, 0.9, 1.0, 1.1, 1.1, 0.9],
  foundation:       [0.6, 0.7, 0.9, 1.1, 1.2, 1.2, 1.2, 1.1, 1.0, 0.9, 0.7, 0.6],
  garage:           [0.7, 0.8, 1.0, 1.1, 1.2, 1.1, 1.1, 1.0, 1.0, 0.9, 0.8, 0.7],
  pool:             [0.5, 0.6, 0.9, 1.2, 1.4, 1.5, 1.3, 1.2, 1.0, 0.8, 0.6, 0.5],
  deck:             [0.5, 0.6, 0.9, 1.2, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.6, 0.5],
  addition:         [0.7, 0.8, 1.0, 1.1, 1.2, 1.1, 1.1, 1.0, 1.0, 0.9, 0.8, 0.7],
};

/* Neutral fallback for unknown trades */
const DEFAULT_FACTORS = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];

/**
 * Returns the seasonal demand multiplier for a trade in a given month.
 *
 * @param trade  - The trade/permit type (case-insensitive). Null/unknown returns 1.0.
 * @param month  - 0-indexed month (0 = January). Defaults to current month.
 * @returns A multiplier between 0.5 and 1.5.
 */
export function getSeasonalFactor(trade: string | null | undefined, month?: number): number {
  const m = month ?? new Date().getMonth();
  const safeMonth = Math.max(0, Math.min(11, m));

  if (!trade) return DEFAULT_FACTORS[safeMonth];

  const normalized = trade.toLowerCase().trim();
  // A whitespace-only trade passes the `!trade` guard above but trims to "".
  // `key.includes("")` is always true, so the partial-match loop below would
  // wrongly return the FIRST table entry (roofing). Treat empty as no trade.
  if (!normalized) return DEFAULT_FACTORS[safeMonth];

  /* Try exact match first */
  if (SEASONAL_FACTORS[normalized]) {
    return SEASONAL_FACTORS[normalized][safeMonth];
  }

  /* Try partial match — e.g. "hvac repair" matches "hvac" */
  for (const [key, factors] of Object.entries(SEASONAL_FACTORS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return factors[safeMonth];
    }
  }

  return DEFAULT_FACTORS[safeMonth];
}

/**
 * Returns a human-readable season label for display in factor explanations.
 */
export function getSeasonLabel(factor: number): string {
  if (factor >= 1.3) return "peak season";
  if (factor >= 1.1) return "high season";
  if (factor >= 0.9) return "normal season";
  if (factor >= 0.7) return "low season";
  return "off-season";
}
