/**
 * Pure helpers extracted from `route.ts` for unit-testability. Mirrors the
 * sibling `src/app/api/cron/re-enrich/helpers.ts`, which exists for the same
 * reason: the patch-building decision is the cron's hot path and the only
 * place that decides whether a lead is ever marked as attempted.
 *
 * The attempt stamp is the important half. The cron selects candidates with
 * `year_built IS NULL`, and the update used to be gated on the patch being
 * non-empty — so a lead whose sources cannot produce a `year_built` was
 * written to by nothing, still matched the identical filter on the next run,
 * and was re-processed on every run forever. `enrich_attempted_at` records
 * that the lead was TRIED, so the scan can walk forward into leads it has
 * not examined yet. This is the same fix `permits.geocode_attempted_at`
 * (migration 00134) applied to the Census geocoder.
 *
 * See `__tests__/helpers.test.ts` for the unit suite.
 */

/** Days before a lead this cron could not improve is offered to it again.
 *  Upstream county / parcel data does get corrected, so an attempt is not
 *  permanent — it just stops the same head of the queue being re-ground
 *  four times a day. Matches the re-enrich cron's staleness window. */
export const ENRICH_RETRY_AFTER_DAYS = 30;

/** ISO cutoff for the "attempted long enough ago to retry" arm of the
 *  candidate filter. `now` is injected for tests. */
export function enrichAttemptCutoff(
  now: Date = new Date(),
  days: number = ENRICH_RETRY_AFTER_DAYS,
): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Subset of the existing lead row the patch builder reads. Keys must match
 *  column names in the leads table — the builder uses string keys to
 *  short-circuit no-op writes. */
export type LeadRowSubset = Record<string, unknown>;

/** Subset of the orchestrator's `EnrichedContact` that this cron writes.
 *  Kept loose so the helper absorbs new orchestrator fields without forcing
 *  a coordinated change here. */
export interface EnrichHit {
  owner_name: string | null;
  owner_first: string | null;
  owner_last: string | null;
  phone: string | null;
  email: string | null;
  mailing_address: string | null;
  year_built: number | null;
  home_sqft: number | null;
  lot_sqft: number | null;
  assessed_value: number | null;
  property_value: number | null;
  owner_occupied: boolean | null;
  employer?: string | null;
  occupation?: string | null;
  primary_source?: string | null;
  confidence?: number | null;
}

export interface BuildEnrichPatchOptions {
  /** Include employer/occupation. Mirrors `WRITE_EXTENDED === "1"`. */
  writeExtended?: boolean;
  /** Attach contact_source / contact_confidence / contact_extracted_at, but
   *  only when a real field also changed. Mirrors `WRITE_PROVENANCE === "1"`. */
  writeProvenance?: boolean;
  /** Include the `enrich_attempted_at` stamp. False when migration 00139
   *  has not been applied yet — including a column that does not exist
   *  fails the whole UPDATE and would drop the contact data we just found. */
  stampAttempt?: boolean;
  /** Override `new Date().toISOString()`. Tests inject a fixed value. */
  nowIso?: string;
}

export interface EnrichPatchResult {
  /** Update payload for `supabase.from("leads").update(patch)`. Contains
   *  `enrich_attempted_at` whenever `stampAttempt` is set, so it may be
   *  non-empty even when the lead gained nothing. */
  patch: Record<string, unknown>;
  /** Count of NON-timestamp fields that actually changed value. The route's
   *  `enriched` counter and its re-score trigger both key off this, never
   *  off `Object.keys(patch).length`. */
  realFieldsChanged: number;
}

/**
 * Build the minimal update patch for one enrichment attempt.
 *
 * Contract:
 *   - Skip a field when the new value is null (never null-out existing data).
 *   - Skip a field when `lead[key]` is non-null AND identical (no-op write).
 *   - `home_sqft` / `lot_sqft` are stored as text — coerce to string before
 *     the equality check so "1234" === "1234" short-circuits.
 *   - `enrich_attempted_at` is included whenever `stampAttempt` is set, even
 *     when nothing else changed. It is the proof the lead was tried, and it
 *     does NOT count toward `realFieldsChanged`.
 */
export function buildEnrichPatch(
  lead: LeadRowSubset,
  hit: EnrichHit,
  opts: BuildEnrichPatchOptions = {},
): EnrichPatchResult {
  const patch: Record<string, unknown> = {};
  let realFieldsChanged = 0;
  const assign = (key: string, value: unknown): void => {
    if (value == null) return;
    if (lead[key] != null && lead[key] === value) return;
    patch[key] = value;
    realFieldsChanged++;
  };

  assign("owner_name", hit.owner_name);
  assign("owner_first", hit.owner_first);
  assign("owner_last", hit.owner_last);
  assign("phone", hit.phone);
  assign("email", hit.email);
  assign("mailing_address", hit.mailing_address);
  assign("year_built", hit.year_built);
  assign("home_sqft", hit.home_sqft != null ? String(hit.home_sqft) : null);
  assign("lot_sqft", hit.lot_sqft != null ? String(hit.lot_sqft) : null);
  assign("assessed_value", hit.assessed_value);
  assign("property_value", hit.property_value);
  assign("owner_occupied", hit.owner_occupied);

  if (opts.writeExtended) {
    assign("employer", hit.employer ?? null);
    assign("occupation", hit.occupation ?? null);
  }

  if (opts.writeProvenance && hit.primary_source && realFieldsChanged > 0) {
    patch.contact_source = hit.primary_source;
    patch.contact_confidence = hit.confidence ?? null;
    patch.contact_extracted_at = opts.nowIso ?? new Date().toISOString();
  }

  if (opts.stampAttempt) {
    patch.enrich_attempted_at = opts.nowIso ?? new Date().toISOString();
  }

  return { patch, realFieldsChanged };
}
