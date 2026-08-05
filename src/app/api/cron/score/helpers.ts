/**
 * Pure helpers extracted from `route.ts` for unit-testability.
 *
 * The cron route handler runs against a NextRequest and a real admin
 * Supabase client — that surface is too wide to test cleanly without
 * also testing supabase-js, the route runtime, etc. The deterministic
 * pieces (raw-json field extraction across casing variants + the
 * round-robin contractor assignment that powers wedge bullet #1) are
 * lifted out here so vitest can exercise them in isolation.
 *
 * The route itself imports from this module — there is no duplication.
 * See `__tests__/helpers.test.ts` for the unit suite.
 */

/* ── Owner-field extractor across jurisdictions ──────────────────────────
 * Different permit portals use wildly different raw_json key casing:
 *   CT open-data:  owner_first / owner_last
 *   LA city:       OWNER_NAME / ApplicantName
 *   Miami-Dade:    OwnerFirst / OwnerLast
 *   Generic:       applicant_name / APPLICANT_NAME
 * Returns the first non-empty string across a list of candidate keys, so
 * the scorer doesn't have to be taught a new casing for every new feed. */
export function pickRawField(
  raw: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!raw) return null;
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

export interface OwnerFields {
  first: string | null;
  last: string | null;
  full: string | null;
  phone: string | null;
  email: string | null;
  contractor: string | null;
}

export function extractOwnerFields(
  raw: Record<string, unknown> | null | undefined,
): OwnerFields {
  return {
    first: pickRawField(raw, [
      "owner_first", "OwnerFirst", "OWNER_FIRST", "first_name", "FIRST_NAME",
      "applicant_first", "APPLICANT_FIRSTNAME", "ApplicantFirst",
    ]),
    last: pickRawField(raw, [
      "owner_last", "OwnerLast", "OWNER_LAST", "last_name", "LAST_NAME",
      "applicant_last", "APPLICANT_LASTNAME", "ApplicantLast",
    ]),
    full: pickRawField(raw, [
      "owner_name", "OwnerName", "OWNER_NAME", "owners_name", "OWNERS_NAME",
      // Orlando (and other parcel-joined feeds) ship the owner under a
      // `parcel_`/`property_` prefix. Missing these cost 26,873 owner
      // names in Orlando alone — the scorer read null and the
      // contact_completeness signal scored 0 for rows that HAD a name.
      // Keep in sync with src/lib/scrapers/extract-contact.ts.
      "parcel_owner_name", "property_owner_name", "parcel_owner", "owner_1",
      "applicant_name", "APPLICANT_NAME", "ApplicantName", "Applicant",
    ]),
    phone: pickRawField(raw, [
      "owner_phone", "OwnerPhone", "OWNER_PHONE", "phone", "PHONE", "Phone",
      // Same Orlando blind spot — 18,804 phones. Phone fill is the
      // binding constraint on lead scores (top score is ~69 against a
      // 75 "hot" threshold), so these keys matter more than most.
      "contractor_phone_number", "contractor_phone_1", "owner_phone_number",
      "applicant_phone", "APPLICANT_PHONE",
    ]),
    email: pickRawField(raw, [
      "owner_email", "OwnerEmail", "OWNER_EMAIL", "email", "EMAIL", "Email",
      "applicant_email", "APPLICANT_EMAIL",
    ]),
    contractor: pickRawField(raw, [
      "contractor_name", "ContractorName", "CONTRACTOR_NAME",
      "contractor", "Contractor", "CONTRACTOR",
    ]),
  };
}

/* ── Address normalization ───────────────────────────────────────────────
 * Mirrors the format used by `scripts/build-address-history.ts`:
 *   lower(trim(address).replace(/[.,#]/g,"").replace(/\s+/g," ")) + "|" + zip
 * Used as the join key into the `address_permit_history` rollup. */
export function normalizeAddrKey(
  address: string | null | undefined,
  zip: string | null | undefined,
): string | null {
  if (!address) return null;
  const cleaned = address.toLowerCase().replace(/[.,#]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return `${cleaned}|${zip ?? ""}`;
}

/* ── Round-robin contractor assignment ──────────────────────────────────
 * Wedge bullet #1: one contractor per permit per trade. Across many
 * permits in the same ZIP we still rotate fairly so a single contractor
 * never monopolizes a territory. The route was inlining this logic in a
 * 100-line for-loop — extracting keeps the test surface narrow without
 * pulling in `evaluateRules`, `mineDescription`, etc.
 *
 * Contract:
 *   - Iterate scoredItems in order.
 *   - For each item with a non-empty zip, find the contractor list
 *     for that zip and assign the next contractor in cyclic order.
 *   - If a zip has no contractors, the item is skipped (no orphan
 *     leads — they get picked up later when a contractor claims it).
 *   - Counter is per-zip so independent zips don't interfere. */
export interface RoundRobinItem<T> {
  /** The scored lead / permit / whatever — passthrough payload. */
  payload: T;
  /** Zip code used as the round-robin key. */
  zip: string | null;
}

export interface RoundRobinAssignment<T, C> {
  payload: T;
  contractor: C;
}

/**
 * Returns one assignment per (item, contractor) pair where the item's zip
 * has at least one contractor in the map. Items in empty-contractor zips
 * are dropped (they're picked up later when a contractor claims them).
 * Counter advances per-zip so multiple zips don't share a counter.
 */
export function assignContractorRoundRobin<T, C>(
  zipToContractors: Map<string, C[]>,
  items: ReadonlyArray<RoundRobinItem<T>>,
): RoundRobinAssignment<T, C>[] {
  const counters = new Map<string, number>();
  const out: RoundRobinAssignment<T, C>[] = [];
  for (const it of items) {
    if (!it.zip) continue;
    const contractors = zipToContractors.get(it.zip);
    if (!contractors || contractors.length === 0) continue;
    const counter = counters.get(it.zip) ?? 0;
    const contractor = contractors[counter % contractors.length];
    counters.set(it.zip, counter + 1);
    out.push({ payload: it.payload, contractor });
  }
  return out;
}

/* ── Permit type → DB enum ──────────────────────────────────────────────
 * Maps free-text upstream permit types to the narrow database enum.
 * Defensive: anything we don't recognize collapses to "other" so we
 * never violate the column's enum constraint at insert time. */
export type PermitTypeEnum =
  | "residential"
  | "commercial"
  | "demolition"
  | "renovation"
  | "new_construction"
  | "addition"
  | "repair"
  | "other";

export function mapPermitType(text: string | null | undefined): PermitTypeEnum {
  if (!text) return "other";
  const lower = text.toLowerCase();
  // Order matters: the more-specific keywords come first so e.g.
  // "new construction" doesn't get caught by the bare "new" branch
  // farther down. Same idea for "demolition" before "demo".
  if (/demol|wreck/i.test(lower)) return "demolition";
  if (/new\s*(construction|building)|construct\s+new/i.test(lower)) return "new_construction";
  if (/renovation|alteration|remodel|tenant improvement|interior|rehab/i.test(lower))
    return "renovation";
  if (/addition|add[\s-]on/i.test(lower)) return "addition";
  if (/repair|foundation repair/i.test(lower)) return "repair";
  if (/commercial|non-residential/i.test(lower)) return "commercial";
  if (/residential|1-2 family|one or two family|single family|dwelling/i.test(lower))
    return "residential";
  return "other";
}

/* ── Dedup key for upstream pre-insert filtering ─────────────────────────
 * Same shape as `permits` cron's dedupKey but lifted here so the score
 * cron can pre-filter equivalents before a multi-source merge.
 * (Currently the score cron doesn't dedupe directly — included so the
 * helper is reachable from a future pre-score dedupe pass.) */
export function dedupKey(
  permitNumber: string,
  city: string | null | undefined,
): string {
  const c = (city ?? "").toLowerCase().trim();
  return `${permitNumber.toLowerCase().trim()}::${c}`;
}
