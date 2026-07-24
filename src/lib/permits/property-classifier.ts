/**
 * Property-type classifier — a SEPARATE axis from project-type.
 *
 * `mapPermitTypeToEnum` (src/lib/ingest/normalize.ts) answers "what KIND of
 * work" (renovation / addition / repair / new construction / demolition).
 * This answers "what kind of PROPERTY" (a homeowner's house vs. a commercial
 * building). Henri is pitched at homeowners, so contractors need to hide the
 * commercial noise — e.g. a hospital's food-court tenant improvement — that a
 * homeowner-lead product should never surface.
 *
 * Design: keyword match over the raw permit_type (+ description when present).
 * Deliberately CONSERVATIVE — when signals are absent or contradictory it
 * returns "unknown", never a guess. The consuming filter ("Exclude commercial")
 * only removes rows confidently classified `commercial`, so residential AND
 * unknown rows always stay visible. This honours the wedge rule: never
 * silently drop rows the contractor might want.
 */

export type PropertyType = "residential" | "commercial" | "unknown";

/* Unambiguously non-residential markers. Multi-family / apartment are
 * intentionally OMITTED — a large apartment reroof is a legitimately
 * desirable job, so we don't want the filter to swallow it. */
const COMMERCIAL_RE =
  /\b(commercial|non[\s-]?residential|tenant\s*improvement|retail|office|restaurant|hotel|motel|hospital|clinic|medical\s*office|industrial|warehouse|manufacturing|mercantile|institutional|shopping|\bmall\b|mixed[\s-]use|church|school|university|government|municipal|factory)\b/i;

/* Residential markers. `house` / `home` are intentionally omitted — too
 * generic and prone to matching "warehouse" etc. */
const RESIDENTIAL_RE =
  /\b(residential|single[\s-]?family|1[\s-]?2 family|one (?:or|and) two family|1 & 2 family|dwelling|duplex|triplex|townhome|townhouse|\bsfr\b|\badu\b|accessory dwelling)\b/i;

/* Guards against "non-residential" (which contains "residential") being read
 * as a residential signal. */
const NON_RESIDENTIAL_RE = /non[\s-]?residential/i;

/**
 * Classify a permit's property type from its type string and (optional)
 * description. Returns "unknown" when nothing decisive is present or when
 * both residential and commercial signals appear.
 */
export function classifyPropertyType(
  permitType?: string | null,
  description?: string | null,
): PropertyType {
  const hay = `${permitType ?? ""} ${description ?? ""}`.trim();
  if (!hay) return "unknown";

  const isCommercial = COMMERCIAL_RE.test(hay);
  // "non-residential" matches RESIDENTIAL_RE by substring — subtract it back out.
  const isResidential = RESIDENTIAL_RE.test(hay) && !NON_RESIDENTIAL_RE.test(hay);

  if (isCommercial && !isResidential) return "commercial";
  if (isResidential && !isCommercial) return "residential";
  return "unknown";
}
