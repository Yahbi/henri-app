/* ── Financing Partner Directory ─────────────────────────────────────────────
 * Reference data for the financing dashboard.
 * These are real contractor financing companies with approximate rates.
 * Rates and terms are indicative — actual offers depend on credit approval.
 * ────────────────────────────────────────────────────────────────────────── */

export interface FinancingPartner {
  name: string;
  rate: string;
  terms: string;
  description: string;
}

export const FINANCING_PARTNERS: FinancingPartner[] = [
  {
    name: "GreenSky",
    rate: "7.99%",
    terms: "12 -- 60 months",
    description:
      "Home improvement financing with instant credit decisions. Widely accepted by contractors nationwide.",
  },
  {
    name: "Mosaic",
    rate: "4.99%",
    terms: "12 -- 25 years",
    description:
      "Specializes in solar and home improvement loans with competitive rates and flexible terms.",
  },
  {
    name: "Service Finance",
    rate: "6.99%",
    terms: "24 -- 60 months",
    description:
      "Contractor-focused financing with same-as-cash options and deferred interest plans.",
  },
];
