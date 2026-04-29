/**
 * Pure helpers extracted from `route.ts` for unit-testability.
 *
 * The re-enrichment cron's hot path is `buildEnrichmentPatch` — given the
 * existing lead row and a fresh enrichment hit, decide which fields
 * actually changed and produce a minimal update payload. The B7 fix
 * (audit 2026-04-27) made this discrimination matter: previously every
 * nightly run would re-stamp `home_sqft` / `lot_sqft` even when the
 * value was identical, churning `updated_at`, lighting up Supabase
 * realtime, and corrupting the `enriched` counter. Without tests a
 * future refactor could revert that and silently re-update every
 * previously-enriched lead nightly.
 *
 * The route imports from this module — there is no duplication.
 * See `__tests__/helpers.test.ts` for the unit suite.
 */

/** Subset of the existing lead row that the patch builder actually
 *  reads. Keys must match column names in the leads table — the
 *  builder uses string keys to short-circuit no-op writes. */
export type LeadRowSubset = Record<string, unknown>;

/** Subset of the orchestrator's `EnrichedContact` that re-enrich routes
 *  through the patch builder. Keep this loose so the helper can absorb
 *  new orchestrator fields without forcing a coordinated change here. */
export interface EnrichmentHit {
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

export interface BuildPatchOptions {
  /** When set, includes employer/occupation in the candidate fields.
   *  Mirrors `process.env.WRITE_EXTENDED === "1"` in the route. */
  writeExtended?: boolean;
  /** When set + the hit has primary_source, attaches contact_source +
   *  contact_confidence + contact_extracted_at — but ONLY if some real
   *  field also changed. Mirrors `process.env.WRITE_PROVENANCE === "1"`
   *  in the route. */
  writeProvenance?: boolean;
  /** Override `new Date().toISOString()` for the always-on
   *  `last_enriched_at` stamp. Tests inject a deterministic value. */
  nowIso?: string;
}

export interface PatchResult {
  /** Update payload for `supabase.from("leads").update(patch)`. Always
   *  contains `last_enriched_at` (the proof-of-attempt stamp); may be
   *  the only key when the row is fully up-to-date. */
  patch: Record<string, unknown>;
  /** Number of NON-timestamp fields that actually changed value. The
   *  route's `enriched` counter increments only when this is > 0 — a
   *  row whose only change is the timestamp does NOT count. */
  realFieldsChanged: number;
}

/**
 * Build the minimal update patch for a re-enrichment pass.
 *
 * Contract (Audit B7 fix, 2026-04-27):
 *   - Skip a field entirely when the new value is null (never null-out
 *     existing data).
 *   - Skip a field when `lead[key]` is non-null AND identical to the
 *     new value (no-op write avoided).
 *   - `home_sqft` / `lot_sqft` are stored as text — coerce to string
 *     before equality so "1234" === "1234" passes the short-circuit.
 *   - `last_enriched_at` is ALWAYS included as proof we tried, even if
 *     no real fields changed. This prevents the same lead from being
 *     re-picked by every nightly run forever.
 *   - `realFieldsChanged > 0` is the gate for the `enriched` counter
 *     in the caller — never `Object.keys(patch).length > 1`.
 */
export function buildEnrichmentPatch(
  lead: LeadRowSubset,
  hit: EnrichmentHit,
  opts: BuildPatchOptions = {},
): PatchResult {
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
  // home_sqft / lot_sqft are stored as text — stringify before equality
  // check so "1234" === "1234" passes the assign() short-circuit.
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

  // Always update last_enriched_at — even if nothing changed, the timestamp
  // is the proof we tried. Without this, the same lead would be re-picked
  // by every nightly run forever. Tracked separately from realFieldsChanged.
  patch.last_enriched_at = opts.nowIso ?? new Date().toISOString();

  return { patch, realFieldsChanged };
}
