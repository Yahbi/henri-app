/**
 * DIY-vs-pro permit applicant classifier
 *
 * Phase 1.3 of the 2026-04-26 product roadmap. The user's vision:
 *
 *   "we should be able to see who made the request for that permit"
 *
 * Contractors want to know whether the homeowner pulled the permit
 * themselves (DIY — high outreach intent), whether a contractor already
 * pulled it on the homeowner's behalf (pro — likely already engaged),
 * or whether this is a spec/investor-pulled permit (cascade pattern,
 * different outreach script).
 *
 * Pure function. No I/O. The `permits.applicant_name` and
 * `permits.contractor_name` columns ship from migration 00004 and
 * `cascade_count` ships from the address-permit-history aggregation
 * (migration 00025). This is a UI-surfacing job — no new DB writes.
 *
 * ## Outreach implications
 *
 * - **homeowner-pulled**: highest intent. Send the permit-specific SMS
 *   per wedge contract bullet #4. Don't apologize for reaching out;
 *   they've signaled interest.
 * - **contractor-pulled**: a contractor already has the job. Soft
 *   outreach only — "for your next project, here's what we've seen
 *   work for similar homes". Some scripts skip contractor-pulled
 *   permits entirely (configurable per-contractor).
 * - **spec/investor-pulled**: portfolio owner. Different language —
 *   talk about volume pricing, project pipelines, scheduling
 *   reliability. Not the personal-touch angle.
 *
 * The drawer shows a colored chip with the type so the contractor can
 * tailor outreach without reading the raw permit fields.
 */

/** Subset of permit fields needed for classification. Avoids importing
 *  the full Permit type, which has 40+ optional fields. */
export interface PermitForClassifier {
  applicant_name?: string | null;
  contractor_name?: string | null;
  /** Owner name on the permit. Used to detect homeowner-pulled permits
   *  (applicant_name === owner_name). */
  owner_name?: string | null;
}

/** Subset of lead fields for spec-detection. */
export interface LeadForClassifier {
  cascade_count?: number | null;
}

export type ApplicantType = "homeowner" | "contractor" | "spec";

export interface ClassificationResult {
  type: ApplicantType;
  /** Display label for the chip. e.g. "Homeowner-pulled", "Pulled by
   *  Henderson Roofing LLC", "Spec/investor". */
  label: string;
  /** When `type === "contractor"`, the contractor's business name. */
  contractor_name?: string;
  /** Outreach hint for the drawer's helper text. */
  hint: string;
}

/* ── Helpers ────────────────────────────────────────────────────────── */

/** Lowercase + collapse whitespace for name comparison. Avoids false
 *  negatives from extra spaces ("John  Smith" vs "John Smith") or
 *  case differences. */
function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple corp-suffix detector. Used as a tiebreaker when
 *  applicant_name is set but doesn't match owner_name — corp names
 *  almost certainly aren't homeowners. */
function looksLikeCompany(s: string | null | undefined): boolean {
  if (!s) return false;
  const lower = s.toLowerCase();
  return /\b(llc|inc|corp|company|co\.?|llp|lp|ltd|construction|builders?|contractors?|roofing|hvac|plumbing|electric(?:al)?|services?)\b/i.test(
    lower,
  );
}

/* ── Classifier ─────────────────────────────────────────────────────── */

/**
 * Classify the applicant of a permit. Pure function; safe to call from
 * any context (server, client, test).
 *
 * Decision tree:
 *   1. cascade_count > 3 → spec/investor (volume pull pattern)
 *   2. contractor_name set AND not == owner_name → contractor-pulled
 *   3. applicant_name looks like a company → contractor-pulled
 *   4. applicant_name == owner_name (or owner_name fields empty) → homeowner
 *   5. fallback → homeowner (highest-intent default; cheap to be wrong)
 */
export function classifyApplicant(
  permit: PermitForClassifier,
  lead?: LeadForClassifier,
): ClassificationResult {
  const cascade = lead?.cascade_count ?? 0;
  const owner = normalizeName(permit.owner_name);
  const applicant = normalizeName(permit.applicant_name);
  const contractor = normalizeName(permit.contractor_name);

  // 1. Spec/investor: high cascade count. We're conservative (>3) so we
  //    don't mistake one repeat-permit homeowner for a portfolio.
  if (cascade > 3) {
    return {
      type: "spec",
      label: "Spec / investor",
      hint:
        "High-volume permit puller. Outreach should focus on volume pricing, scheduling reliability, and pipeline rather than personal touch.",
    };
  }

  // 2. Contractor-pulled: contractor_name set, distinct from owner.
  if (contractor && contractor !== owner) {
    return {
      type: "contractor",
      label: `Pulled by ${permit.contractor_name}`,
      contractor_name: permit.contractor_name ?? undefined,
      hint:
        "A contractor already filed this permit on the owner's behalf. Soft outreach only — they likely have a tradesperson lined up. Position as the next-project relationship.",
    };
  }

  // 3. applicant_name looks like a corporate entity → almost certainly
  //    a contractor-pulled permit even if contractor_name was missed.
  if (looksLikeCompany(permit.applicant_name) && applicant !== owner) {
    return {
      type: "contractor",
      label: `Pulled by ${permit.applicant_name}`,
      contractor_name: permit.applicant_name ?? undefined,
      hint:
        "Permit applicant looks like a business — likely contractor-pulled. Soft outreach only.",
    };
  }

  // 4. applicant_name === owner_name → homeowner-pulled. Highest intent.
  if (applicant && applicant === owner) {
    return {
      type: "homeowner",
      label: "Homeowner-pulled",
      hint:
        "Owner pulled this permit themselves — highest outreach intent. Send the permit-specific template per wedge contract #4.",
    };
  }

  // 5. Fallback: assume homeowner. The cost of being wrong here is a
  //    slightly-too-warm outreach, which is the safer side to err on.
  return {
    type: "homeowner",
    label: "Likely homeowner-pulled",
    hint:
      "Unable to verify the permit applicant; default to homeowner-pulled. Outreach should reference the permit but acknowledge the applicant might be the owner's representative.",
  };
}
