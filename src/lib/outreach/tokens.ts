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
  return input.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, rawKey: string) => {
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
