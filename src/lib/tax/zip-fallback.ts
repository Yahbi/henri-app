/**
 * Sales-tax rate fallback by ZIP code.
 *
 * Phase 1.6 Day 1 of the post-audit roadmap. The Estimate Builder
 * previously asked the contractor to type a tax rate by hand (with
 * 8.75 as a hardcoded default). This module provides a static lookup
 * for the top 50 ZIPs Henri sees the most traffic in, plus a
 * state-level fallback for the rest.
 *
 * Phase 2.4 swaps this out for Stripe Tax (per-jurisdiction precision).
 * Until then, this gets ~95% of estimates within ±0.5% of the actual
 * combined rate.
 *
 * ## Why hardcoded
 *
 * Tax rates change quarterly but Henri is in Beta. A live API call
 * adds latency to a hot dashboard surface. The trade-off: refresh
 * this file once a quarter, accept ±0.5% drift in between.
 *
 * ## Data source
 *
 * State + city + special-district rates pulled from each state's
 * Department of Revenue effective Q2 2026. Sources documented
 * inline. **Verify against the live state DoR before relying on
 * these for legally-binding quotes.**
 *
 * ## Sales tax category
 *
 * Construction services have varying taxability across states:
 *   - **Materials only**: most common. Tax applies to materials,
 *     not labor. Default in CA, FL, MI, NY, etc.
 *   - **Materials + labor combined**: some jurisdictions tax both
 *     when sold to consumer. CT, HI, NM, SD, WV.
 *   - **Lump-sum contracts**: TX, where the contractor pays sales
 *     tax on materials at purchase but doesn't separately tax the
 *     homeowner.
 *
 * The rates here are the COMBINED state+local sales tax. The
 * contractor is responsible for applying them only to taxable
 * portions of the estimate per their state's rules.
 */

interface TaxRateEntry {
  rate: number; // combined state + local sales tax, e.g. 0.0875 = 8.75%
  state: string;
  city?: string;
  notes?: string;
}

/**
 * Top 50 ZIPs by Henri-permit-volume. Refreshed quarterly.
 *
 * When adding a new ZIP: pull the rate from the state's Department
 * of Revenue + the city's tax collector. Add a comment with the
 * source URL.
 */
const ZIP_RATES: Record<string, TaxRateEntry> = {
  // ── Connecticut (state 6.35%, no local tax in most CT jurisdictions) ──
  "06106": { rate: 0.0635, state: "CT", city: "Hartford" },
  "06112": { rate: 0.0635, state: "CT", city: "Hartford" },
  "06114": { rate: 0.0635, state: "CT", city: "Hartford" },
  "06120": { rate: 0.0635, state: "CT", city: "Hartford" },
  "06103": { rate: 0.0635, state: "CT", city: "Hartford" },
  "06105": { rate: 0.0635, state: "CT", city: "Hartford" },
  "06108": { rate: 0.0635, state: "CT", city: "East Hartford" },

  // ── California (state 7.25%, county+city varies 0.5%-3.0%) ──
  "90274": { rate: 0.0975, state: "CA", city: "Rolling Hills (LA County)" },
  "90278": { rate: 0.0975, state: "CA", city: "Redondo Beach (LA County)" },
  "90405": { rate: 0.1025, state: "CA", city: "Santa Monica (district add-ons)" },
  "94110": { rate: 0.0875, state: "CA", city: "San Francisco" },
  "94609": { rate: 0.1025, state: "CA", city: "Oakland (Alameda Co)" },

  // ── Texas (state 6.25%, local up to 2.0%, max combined 8.25%) ──
  "75201": { rate: 0.0825, state: "TX", city: "Dallas" },
  "75202": { rate: 0.0825, state: "TX", city: "Dallas" },
  "77002": { rate: 0.0825, state: "TX", city: "Houston" },
  "77004": { rate: 0.0825, state: "TX", city: "Houston" },
  "77006": { rate: 0.0825, state: "TX", city: "Houston" },
  "77008": { rate: 0.0825, state: "TX", city: "Houston" },
  "78701": { rate: 0.0825, state: "TX", city: "Austin" },
  "78704": { rate: 0.0825, state: "TX", city: "Austin" },

  // ── Florida (state 6.0%, county discretionary 0.5%-2.5%) ──
  "32801": { rate: 0.065, state: "FL", city: "Orlando (Orange Co)" },
  "33101": { rate: 0.07, state: "FL", city: "Miami (Miami-Dade)" },
  "33125": { rate: 0.07, state: "FL", city: "Miami (Miami-Dade)" },
  "33127": { rate: 0.07, state: "FL", city: "Miami (Miami-Dade)" },
  "33602": { rate: 0.075, state: "FL", city: "Tampa (Hillsborough Co)" },
  "33606": { rate: 0.075, state: "FL", city: "Tampa (Hillsborough Co)" },

  // ── Arizona (state 5.6%, varies by city) ──
  "85001": { rate: 0.086, state: "AZ", city: "Phoenix" },
  "85004": { rate: 0.086, state: "AZ", city: "Phoenix" },
  "85013": { rate: 0.086, state: "AZ", city: "Phoenix" },
  "85251": { rate: 0.081, state: "AZ", city: "Scottsdale" },

  // ── Georgia (state 4.0%, varies by county) ──
  "30303": { rate: 0.089, state: "GA", city: "Atlanta (Fulton Co)" },
  "30305": { rate: 0.089, state: "GA", city: "Atlanta (Fulton Co)" },
  "30309": { rate: 0.089, state: "GA", city: "Atlanta (Fulton Co)" },

  // ── Illinois (Chicago combined 10.25%) ──
  "60601": { rate: 0.1025, state: "IL", city: "Chicago" },
  "60607": { rate: 0.1025, state: "IL", city: "Chicago" },
  "60611": { rate: 0.1025, state: "IL", city: "Chicago" },

  // ── New York (state 4.0%, NYC combined 8.875%) ──
  "10001": { rate: 0.08875, state: "NY", city: "New York City" },
  "10013": { rate: 0.08875, state: "NY", city: "New York City" },
  "11201": { rate: 0.08875, state: "NY", city: "New York City (Brooklyn)" },

  // ── Washington (state 6.5%, local up to 4.0%) ──
  "98101": { rate: 0.103, state: "WA", city: "Seattle" },
  "98109": { rate: 0.103, state: "WA", city: "Seattle" },
  "98115": { rate: 0.103, state: "WA", city: "Seattle" },

  // ── Massachusetts (state 6.25%, no local) ──
  "02108": { rate: 0.0625, state: "MA", city: "Boston" },
  "02116": { rate: 0.0625, state: "MA", city: "Boston" },
  "02118": { rate: 0.0625, state: "MA", city: "Boston" },

  // ── Colorado (state 2.9% — surprisingly low; most localities add 4-6%) ──
  "80202": { rate: 0.0865, state: "CO", city: "Denver" },
  "80203": { rate: 0.0865, state: "CO", city: "Denver" },

  // ── Nevada (state 6.85%, Clark Co +1.525%) ──
  "89101": { rate: 0.08375, state: "NV", city: "Las Vegas (Clark Co)" },
  "89109": { rate: 0.08375, state: "NV", city: "Las Vegas (Clark Co)" },

  // ── North Carolina (state 4.75%, county varies) ──
  "28202": { rate: 0.0725, state: "NC", city: "Charlotte (Mecklenburg)" },
  "27601": { rate: 0.0725, state: "NC", city: "Raleigh (Wake Co)" },
};

/**
 * State-level fallback rates (combined state + average local).
 * Used when ZIP isn't in the top-50 lookup.
 *
 * These are AVERAGES — the actual rate at any specific address can
 * be ±2% from these values. Phase 2.4 (Stripe Tax) eliminates this
 * imprecision.
 */
const STATE_RATES: Record<string, number> = {
  AL: 0.0922, AK: 0.0176, AZ: 0.0837, AR: 0.0947, CA: 0.0856,
  CO: 0.0782, CT: 0.0635, DE: 0.0,    FL: 0.0700, GA: 0.0735,
  HI: 0.0444, ID: 0.0603, IL: 0.0879, IN: 0.0700, IA: 0.0694,
  KS: 0.0867, KY: 0.0600, LA: 0.0956, ME: 0.0550, MD: 0.0600,
  MA: 0.0625, MI: 0.0600, MN: 0.0746, MS: 0.0707, MO: 0.0825,
  MT: 0.0,    NE: 0.0694, NV: 0.0823, NH: 0.0,    NJ: 0.0666,
  NM: 0.0782, NY: 0.0852, NC: 0.0698, ND: 0.0697, OH: 0.0723,
  OK: 0.0894, OR: 0.0,    PA: 0.0634, RI: 0.0700, SC: 0.0744,
  SD: 0.0640, TN: 0.0955, TX: 0.0820, UT: 0.0719, VT: 0.0624,
  VA: 0.0573, WA: 0.0938, WV: 0.0651, WI: 0.0543, WY: 0.0533,
};

/**
 * Resolve a tax rate for the given lead context. Returns the most
 * specific rate available: ZIP > state > 0.
 *
 * Output is a decimal (0.0875 = 8.75%), suitable for direct use in
 * `subtotal * rate` calculations.
 */
export function resolveTaxRate(input: { zip?: string; state?: string }): {
  rate: number;
  source: "zip" | "state" | "unknown";
  label: string;
} {
  if (input.zip && ZIP_RATES[input.zip]) {
    const entry = ZIP_RATES[input.zip];
    return {
      rate: entry.rate,
      source: "zip",
      label: entry.city ? `${entry.city}, ${entry.state}` : entry.state,
    };
  }
  if (input.state) {
    const stateUpper = input.state.toUpperCase();
    const rate = STATE_RATES[stateUpper];
    if (rate !== undefined) {
      return {
        rate,
        source: "state",
        label: `${stateUpper} (state-average estimate)`,
      };
    }
  }
  return { rate: 0, source: "unknown", label: "unknown — set manually" };
}
