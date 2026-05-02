/* ── Outreach template token resolver — Phase 0a wedge #10 ───────────── */
/*                                                                       */
/*  Replaces {{tokens}} in an outreach template body + subject with      */
/*  real lead / contractor / permit data. Used by the Outreach tab's    */
/*  "Preview" button, by the scorer's optional auto-fire path, and      */
/*  by the missed-call text-back pipeline.                              */

export interface OutreachTokenContext {
  /** Homeowner / applicant first name. "there" if unknown. */
  owner_first: string | null;
  /** Last name — rarely used, but available for formal opens. */
  owner_last: string | null;
  /** Short address — just the street-level portion ("642 PARK ST"). */
  address_short: string;
  /** Full address including city/state/zip ("642 PARK ST, HARTFORD, CT 06106"). */
  address_full: string;
  /** City only (for neighbor-context phrasings). */
  city: string | null;
  /** ZIP code. */
  zip: string | null;
  /** Permit number exactly as filed ("MISC-PLM-25-000078"). */
  permit_number: string | null;
  /** Permit description sentence — "Install new flooring, plumbing...". */
  permit_scope: string | null;
  /** Integer days since the permit was filed. */
  days_ago: number | null;
  /** Trade label: "roofing", "hvac", etc. */
  trade: string | null;
  /** Permit estimated dollar value. */
  permit_value: number | null;
  /** Contractor's full name. */
  contractor_name: string;
  /** Contractor's company. */
  contractor_company: string;
  /** Contractor's reply-to phone (E.164 preferred). */
  contractor_phone: string | null;
  /** Min / max typical project value for that trade in the contractor's
   *  capacity prefs — surfaced as "between $X and $Y" in templates. */
  value_min: number | null;
  value_max: number | null;

  /* Wave 1.5 / 2.A / 2.B disaster-context tokens. All optional — use in
   * "I noticed your area was hit by..." style outreach. Resolved from
   * the lead-context API at template render time; null falls through
   * to the empty-fallback so the sentence reads cleanly when the data
   * isn't available. */

  /** Count of NFIP flood claims in the lead's ZIP. */
  nfip_claim_count: number | null;
  /** FEMA NRI risk score 0-100 for the lead's county. */
  nri_risk_score: number | null;
  /** FEMA NRI qualitative tier: "Very Low" / "Relatively Low" / "Relatively
   *  Moderate" / "Relatively High" / "Very High". */
  nri_risk_tier: string | null;
  /** Title of the most recent FEMA disaster declaration in the lead's
   *  state (e.g. "Severe Storms and Flooding"). */
  recent_disaster_title: string | null;
  /** DR/EM number of that recent disaster (e.g. "DR-4806"). */
  recent_disaster_id: string | null;
  /** Count of SWDI hail/wind/tornado signatures within 25mi in the
   *  last 30 days. */
  storm_count_30d: number | null;
  /** Count of CourtListener mechanic-lien dockets in the lead's
   *  state in the last 90 days. */
  lien_count_90d: number | null;
}

const FALLBACKS: Record<keyof OutreachTokenContext, string> = {
  owner_first: "there",
  owner_last: "",
  address_short: "your property",
  address_full: "your property",
  city: "your neighborhood",
  zip: "",
  permit_number: "your recent permit",
  permit_scope: "your project",
  days_ago: "recently",
  trade: "project",
  permit_value: "",
  contractor_name: "",
  contractor_company: "us",
  contractor_phone: "",
  value_min: "",
  value_max: "",
  // Disaster-context fallbacks — empty-string fallbacks make the
  // sentence read cleanly: "your area saw   in the last 90 days"
  // gracefully degrades to "your area saw in the last 90 days" if
  // we omit the token, or contractors can guard the line with an
  // {{#if}} variant in a future template upgrade.
  nfip_claim_count: "",
  nri_risk_score: "",
  nri_risk_tier: "",
  recent_disaster_title: "",
  recent_disaster_id: "",
  storm_count_30d: "",
  lien_count_90d: "",
};

function formatValue(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

function formatContextValue(key: keyof OutreachTokenContext, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") {
    return FALLBACKS[key] ?? "";
  }
  if (key === "permit_value" || key === "value_min" || key === "value_max") {
    return typeof raw === "number" ? formatValue(raw) : FALLBACKS[key];
  }
  if (key === "days_ago") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return FALLBACKS.days_ago;
    if (n < 1) return "today";
    if (n === 1) return "yesterday";
    return String(Math.round(n));
  }
  // Disaster-context numeric tokens — render the integer count (or
  // skip when zero so "0 claims" doesn't surface as a false signal).
  if (
    key === "nfip_claim_count" ||
    key === "storm_count_30d" ||
    key === "lien_count_90d" ||
    key === "nri_risk_score"
  ) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return FALLBACKS[key];
    return String(Math.round(n));
  }
  return String(raw);
}

/**
 * Replace every `{{token}}` occurrence in the input string with its
 * resolved value. Unknown tokens are left intact so a human
 * proofreading a rendered template can see the gap.
 */
export function resolveTokens(
  input: string | null | undefined,
  ctx: Partial<OutreachTokenContext>,
): string {
  if (!input) return "";
  // Token names are alphanumeric + underscore. We accept digits to
  // support tokens like `storm_count_30d` and `lien_count_90d` that
  // bake the lookup window into the name.
  return input.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, rawKey: string) => {
    const key = rawKey.toLowerCase().trim() as keyof OutreachTokenContext;
    if (!(key in FALLBACKS)) return match; // unknown token → leave as-is
    return formatContextValue(key, (ctx as Record<string, unknown>)[key]);
  });
}

/** Render both subject and body of a template in one call. */
export function renderTemplate(
  template: { subject: string | null; body: string },
  ctx: Partial<OutreachTokenContext>,
): { subject: string; body: string } {
  return {
    subject: resolveTokens(template.subject ?? "", ctx),
    body: resolveTokens(template.body, ctx),
  };
}

/**
 * List of every token the resolver recognizes. Surfaced in the
 * Outreach template editor as a "insert token" picker so contractors
 * writing custom templates know what's available.
 */
export const KNOWN_TOKENS = Object.keys(FALLBACKS) as Array<keyof OutreachTokenContext>;
