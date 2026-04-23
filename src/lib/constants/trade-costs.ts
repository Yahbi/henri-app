/**
 * National median cost-per-project by trade and tier.
 *
 * Sources compiled from free public data (HomeAdvisor True Cost, Angi
 * Cost Reports, US Census Building Permits Survey). No per-homeowner
 * lookup — these are rough anchors for the estimate generator so the
 * "Good / Better / Best" tiers aren't arbitrary 1.0× / 1.35× / 1.75×
 * multipliers.
 *
 * Values are in USD for a representative single-family project. The
 * estimate page scales by permit value when available; these ranges
 * are the default when permit value is missing or implausible.
 */

export interface TradeTierPrices {
  good: number;
  better: number;
  best: number;
}

export const TRADE_TIER_PRICES: Record<string, TradeTierPrices> = {
  roofing:        { good:  8500, better: 13500, best: 22000 },
  hvac:           { good:  7500, better: 11500, best: 17500 },
  plumbing:       { good:  2200, better:  5800, best: 12500 },
  electrical:     { good:  3200, better:  6500, best: 14000 },
  solar:          { good: 18000, better: 25000, best: 38000 },
  painting:       { good:  3200, better:  5800, best:  9500 },
  landscaping:    { good:  4500, better:  9500, best: 18000 },
  foundation:     { good:  6500, better: 14500, best: 28000 },
  "general remodel": { good: 22000, better: 48000, best: 95000 },
  adu:            { good: 95000, better: 145000, best: 220000 },
  windows:        { good:  8500, better: 14500, best: 24000 },
  siding:         { good: 10500, better: 16500, best: 26000 },
  flooring:       { good:  3800, better:  7500, best: 14000 },
  bathroom:       { good: 12000, better: 22000, best: 42000 },
  kitchen:        { good: 18000, better: 38000, best: 72000 },
  other:          { good:  5000, better: 10000, best: 20000 },
};

/**
 * Get the tier prices for a trade. Falls back to "other" when the trade
 * isn't in our table (new upstream permit type, etc).
 */
export function getTradeTierPrices(trade: string | null | undefined): TradeTierPrices {
  if (!trade) return TRADE_TIER_PRICES.other;
  const normalized = trade.toLowerCase().trim();
  return TRADE_TIER_PRICES[normalized] ?? TRADE_TIER_PRICES.other;
}

/**
 * Scale the tier prices by the actual permit value when available.
 * Uses the permit value as a ratio against the "better" tier anchor,
 * capped so an outlier permit ($500K deck?) doesn't balloon estimates.
 */
export function scaleTierPrices(trade: string | null | undefined, permitValue?: number | null): TradeTierPrices {
  const base = getTradeTierPrices(trade);
  if (!permitValue || permitValue <= 0) return base;
  // Ratio: if permit value is 1.5× the "better" anchor, scale all tiers 1.5×.
  // Cap between 0.5× and 3× to keep things sane.
  const raw = permitValue / base.better;
  const scale = Math.max(0.5, Math.min(3, raw));
  return {
    good: Math.round(base.good * scale),
    better: Math.round(base.better * scale),
    best: Math.round(base.best * scale),
  };
}
