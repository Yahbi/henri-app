/**
 * Unified Enrichment Orchestrator
 * ───────────────────────────────────────────────────────────────────────────
 * Single entry point that composes every free enrichment source we wire
 * up. Call `enrichLead(context)` from either the batch cron
 * (`/api/cron/enrich`) or the real-time ingest path
 * (`/api/cron/permits`, or a future inline-on-insert hook).
 *
 * NOT to be confused with `./pipeline.ts` — that's the older property-
 * data-only pipeline (FIPS → assessor → Census). This module is the
 * newer, full-contact orchestrator that composes the 8 source modules
 * in this folder.
 *
 * ## Source order (cheapest first, most expensive last)
 *
 * Each pass returns a source-specific result. The orchestrator
 * composes them into a single `EnrichedContact`, preferring the
 * earliest (cheapest) non-null value per field. Later passes can
 * still ADD fields the earlier ones didn't populate.
 *
 *   1. **Upstream seed** — raw_json extraction already done by
 *      `extractContactWithProvenance` before this module is called. Seeds
 *      `owner_name / phone / email / owner_first / owner_last`.
 *   2. **Same-address sibling permits** — 1 REST call. Zero API key.
 *      Hits the DB directly; finds the owner on any sibling permit at
 *      the same address. See queryAddressSiblings below.
 *   3. **Local voter file** (FL / NC / OH, once ingested via
 *      `scripts/ingest-voter-{fl,nc,oh}.ts`). SQL-only lookup against
 *      the `voter_fl / voter_nc / voter_oh` tables.
 *   4. **County GIS** — 22 jurisdictions, free public endpoints. See
 *      `./county-gis.ts`.
 *   5. **Contractor-license board** (CA CSLB today, TX/FL scaffolded).
 *      Free public endpoints. See `./contractor-license.ts`.
 *   6. **OpenCorporates** — 500/day free tier. See `./opencorporates.ts`.
 *   7. **FEC contributor** — 1k/hour free tier. See `./fec-contributor.ts`.
 *   8. **Regrid parcel** — free tier metered. See `./regrid-parcel.ts`.
 *   9. **Voter-registration vendor scaffold** — no-op today. See
 *      `./voter-registration.ts`.
 *  10. **Hunter.io email inference** — 50/month free tier. See
 *      `./hunter-email.ts`.
 *
 * ## What this does NOT do
 *
 *   - Write to the DB. The caller handles persistence. This module
 *     just computes the best available contact record and returns it.
 *   - Run in parallel. Passes are sequential so later passes can short-
 *     circuit when earlier ones already populated what's needed. For
 *     parallelization, the enrich cron spawns multiple workers that
 *     each call this function independently.
 *
 * ## Usage
 *
 * ```ts
 * const enriched = await enrichLead({
 *   address: "123 Main St",
 *   city: "San Francisco",
 *   state: "CA",
 *   zip: "94103",
 *   owner_name: null,                      // known so far
 *   owner_first: null,
 *   owner_last: null,
 *   phone: null,
 *   email: null,
 *   contractor_name: "Smith Plumbing LLC", // from joined permit
 *   supabase: adminClient,                 // for sibling-permit lookup
 * });
 * if (enriched.owner_name) {
 *   // write to leads.owner_name + provenance
 * }
 * ```
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichFromCounty } from "./county-gis";
import { queryRegrid } from "./regrid-parcel";
import { lookupCompanyPrincipal } from "./opencorporates";
import { lookupFECContributor, type FECContributorResult } from "./fec-contributor";
import { lookupContractorLicense } from "./contractor-license";
import { inferEmailFromBusinessName } from "./hunter-email";
import { lookupVoterByAddress } from "./voter-registration";
import { lookupLocalVoterFile } from "./voter-file";
import { lookupPPP } from "./ppp-loan";
import { lookupOSMContact } from "./osm-contact";
import { lookupGooglePlaces } from "./google-places";
import { lookupYelp } from "./yelp-fusion";
import { mineMultiple } from "./description-miner";

/** Input to the orchestrator. All fields optional except address — we
 *  can't enrich without a street at minimum. */
export interface EnrichmentContext {
  /** Street address. "123 Main St" (no city/state/zip appended). */
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;

  /** What we know so far. Used so we don't redundantly re-query for
   *  fields that are already populated upstream. */
  owner_name?: string | null;
  owner_first?: string | null;
  owner_last?: string | null;
  phone?: string | null;
  email?: string | null;

  /** From the joined permit — needed by the contractor-license +
   *  OpenCorporates + Hunter passes. */
  contractor_name?: string | null;
  applicant_name?: string | null;

  /** Free-text fields from the joined permit. Mined for embedded phone
   *  numbers and email addresses — zero external cost. Pass any of
   *  `description`, `scope_of_work`, `notes` that's populated. */
  permit_text?: (string | null | undefined)[];

  /** Phase 1.3 DIY-vs-pro classification result. When set to "contractor",
   *  Phase E will fire the Apollo people-match lookup against the business
   *  name (cost-gated; ~5% of permits at full national scale). Pass null
   *  or omit on the homeowner path — Apollo never fires. The cron computes
   *  this via `classifyApplicant()` from `src/lib/permits/applicant-
   *  classifier.ts` before calling enrichLead(). */
  applicant_classification?: "homeowner" | "contractor" | "spec" | null;

  /** Optional Supabase admin client for the same-address DB lookup.
   *  If omitted, that pass is skipped. */
  supabase?: SupabaseClient | null;
}

/** What the orchestrator returns. All fields may be null. `sources`
 *  tracks WHERE each field came from so callers can weight downstream. */
export interface EnrichedContact {
  owner_name: string | null;
  owner_first: string | null;
  owner_last: string | null;
  phone: string | null;
  email: string | null;
  mailing_address: string | null;
  employer: string | null;
  occupation: string | null;

  year_built: number | null;
  home_sqft: number | null;
  lot_sqft: number | null;
  assessed_value: number | null;
  property_value: number | null;
  owner_occupied: boolean | null;
  last_sale_date: string | null;
  last_sale_price: number | null;

  /* ── Phase E (2026-04-26): WeatherStack + Numverify + Cloudmersive ──
   * Free-tier API additions. All optional; null when:
   *   - The corresponding API key isn't configured
   *   - The free-tier quota for the month is exhausted
   *   - The API call failed (graceful-degrade)
   */
  /** Phone metadata from Numverify or Cloudmersive — drives outreach
   *  channel selection (SMS-preferred for mobile, voice for landline). */
  phone_line_type: "mobile" | "landline" | "voip" | "unknown" | "invalid" | null;
  /** Phone validation pass — false means Twilio will reject anyway. */
  phone_valid: boolean | null;
  /** Carrier name when known. Roofers care because some carriers have
   *  better SMS-deliverability than others. */
  phone_carrier: string | null;
  /** Outreach hint: skip / sms-preferred / voice-preferred / either. */
  phone_strategy: "sms-preferred" | "voice-preferred" | "either" | "skip" | null;
  /** USPS-canonical normalized address from Cloudmersive. */
  address_normalized: string | null;
  /** WeatherStack severity bucket — drives the "Hail event 3 days ago"
   *  drawer chip + outreach urgency boost. */
  weather_severity: "calm" | "minor" | "severe" | null;
  /** WeatherStack hazards array — e.g. ["hail", "high-wind"]. */
  weather_hazards: string[] | null;

  /** Primary source — the pass that contributed most of the contact
   *  identity (owner_name or phone). */
  primary_source: string | null;
  /** 0..1 aggregate confidence. Primary source's confidence plus a
   *  bonus for cross-source agreement. */
  confidence: number;
  /** Per-field provenance for audit. */
  sources: Record<string, string>;
}

/** Helper — copy a field from a hit only when it's populated AND the
 *  target is still null. Tracks source per field. */
function applyField<K extends keyof EnrichedContact>(
  target: EnrichedContact,
  key: K,
  value: EnrichedContact[K] | null | undefined,
  source: string,
): void {
  if (value == null) return;
  if (target[key] != null) return;
  target[key] = value;
  target.sources[key as string] = source;
}

/* ── Same-address sibling-permit owner lookup ──────────────────────── */
async function queryAddressSiblings(
  supabase: SupabaseClient,
  address: string,
  zip: string,
): Promise<{ owner_name: string | null; contractor_name: string | null } | null> {
  try {
    // Audit B6 fix (2026-04-27): the prior `.ilike("address", address)`
    // passed raw upstream text into PostgREST's ILIKE pattern, which
    // means addresses containing `%` (e.g. "100% MELROSE"), `_`, or `\`
    // would silently match unintended rows — the wrong owner gets
    // attributed back to the permit. Intent here is exact-string
    // siblings at the same physical address. Switch to `.eq()` so the
    // pattern operators are literal again.
    const { data } = await supabase
      .from("permits")
      .select("applicant_name, contractor_name")
      .eq("zip", zip)
      .eq("address", address)
      .not("applicant_name", "is", null)
      .order("issued_date", { ascending: false })
      .limit(1);
    const row = data?.[0] as
      | { applicant_name: string | null; contractor_name: string | null }
      | undefined;
    if (!row?.applicant_name) return null;
    return {
      owner_name: row.applicant_name.trim(),
      contractor_name: row.contractor_name ?? null,
    };
  } catch {
    return null;
  }
}

/* ── In-memory result cache ────────────────────────────────────────────
 *
 * Same-address enrichments are surprisingly common: multiple permits at
 * the same property over months/years, the scorer re-processes leads,
 * manual "retry this lead" actions, etc. Without a cache each of these
 * repeats every single external API call — wasteful, slow, and it
 * burns the OpenCorporates 500/day bucket much faster than it needs to.
 *
 * Keyed on (normalized address, zip). Entries expire after TTL. No
 * persistence — the cache is per-lambda-instance, which is fine because
 * each invocation processes hundreds of leads and the hit rate WITHIN
 * a single enrichment cron invocation is high (same-zip batching).
 *
 * Separate cache from the `pipeline.ts` FIPS cache; different concern
 * (that one's property-data only, this one's full-contact).
 */
interface CacheEntry {
  result: EnrichedContact;
  expires: number;
}
const enrichCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — same-day re-enrichment hits
const CACHE_MAX = 2000;                  // hard cap to prevent unbounded growth

function cacheKey(ctx: EnrichmentContext): string {
  return `${ctx.address}|${ctx.zip ?? ""}|${ctx.state ?? ""}`
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cacheGet(key: string): EnrichedContact | null {
  const hit = enrichCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    enrichCache.delete(key);
    return null;
  }
  return hit.result;
}

function cacheSet(key: string, result: EnrichedContact): void {
  if (enrichCache.size >= CACHE_MAX) {
    // Evict the oldest entry — Map preserves insertion order, so the
    // first key IS the oldest. O(1).
    const oldest = enrichCache.keys().next().value;
    if (oldest) enrichCache.delete(oldest);
  }
  enrichCache.set(key, { result, expires: Date.now() + CACHE_TTL_MS });
}

/* ── Per-source telemetry ─────────────────────────────────────────────
 *
 * Process-lifetime counters so a cron invocation can log per-source
 * hit rates at the end. Helps answer "is FEC actually contributing
 * fields?" without cracking open every lead's sources object.
 */
export interface SourceTelemetry {
  calls: number;        // how many times this source was queried
  hits: number;         // how many returned non-null
  totalLatencyMs: number;
}
const telemetry = new Map<string, SourceTelemetry>();
export function getTelemetry(): Record<string, SourceTelemetry> {
  return Object.fromEntries(telemetry.entries());
}
export function resetTelemetry(): void {
  telemetry.clear();
}

/** Instrument a source call — counts + latency. Returns a tagged
 *  pass-through so callers can chain `.then(tap(...))`-style usage. */
async function trace<T>(
  source: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  const result = await fn();
  const latency = Date.now() - t0;
  const prev = telemetry.get(source) ?? { calls: 0, hits: 0, totalLatencyMs: 0 };
  prev.calls++;
  if (result != null) prev.hits++;
  prev.totalLatencyMs += latency;
  telemetry.set(source, prev);
  return result;
}

export async function enrichLead(ctx: EnrichmentContext): Promise<EnrichedContact> {
  const key = cacheKey(ctx);
  const cached = cacheGet(key);
  if (cached) return cached;

  const result: EnrichedContact = {
    owner_name: ctx.owner_name ?? null,
    owner_first: ctx.owner_first ?? null,
    owner_last: ctx.owner_last ?? null,
    phone: ctx.phone ?? null,
    email: ctx.email ?? null,
    mailing_address: null,
    employer: null,
    occupation: null,
    year_built: null,
    home_sqft: null,
    lot_sqft: null,
    assessed_value: null,
    property_value: null,
    owner_occupied: null,
    last_sale_date: null,
    last_sale_price: null,
    // Phase E (2026-04-26 free-tier additions)
    phone_line_type: null,
    phone_valid: null,
    phone_carrier: null,
    phone_strategy: null,
    address_normalized: null,
    weather_severity: null,
    weather_hazards: null,
    primary_source: null,
    confidence: 0,
    sources: {},
  };

  // Seed provenance for fields that came in pre-populated (e.g. from
  // raw_json extracted by extractContactWithProvenance upstream).
  if (ctx.owner_name) result.sources.owner_name = "upstream";
  if (ctx.phone) result.sources.phone = "upstream";
  if (ctx.email) result.sources.email = "upstream";

  /* ── Phase A: sequential DB-only + in-memory passes ────────────────
   *
   * All zero-cost. No network, no API key. Run before any external
   * call so a lead that already has its gaps filled from our own
   * data short-circuits the expensive passes.
   */

  /* Pass 0: Permit-description text mining (synchronous, 0 cost).
   * Extracts phone + email patterns embedded in free-text fields we
   * already have. Only populates when the structured fields upstream
   * didn't catch them. */
  if (ctx.permit_text && ctx.permit_text.length > 0) {
    const mined = mineMultiple(ctx.permit_text);
    if (!result.phone && mined.phones.length > 0) {
      applyField(result, "phone", mined.phones[0]!, "permit_description");
    }
    if (!result.email && mined.emails.length > 0) {
      applyField(result, "email", mined.emails[0]!, "permit_description");
    }
  }

  /* Pass 1: Same-address sibling permits */
  if (!result.owner_name && ctx.supabase && ctx.zip && /^\d{5}$/.test(ctx.zip)) {
    const sibling = await trace("same_address_permit", () =>
      queryAddressSiblings(ctx.supabase!, ctx.address, ctx.zip!),
    );
    if (sibling?.owner_name) {
      applyField(result, "owner_name", sibling.owner_name, "same_address_permit");
      if (!result.primary_source) {
        result.primary_source = "same_address_permit";
        result.confidence = 0.85;
      }
    }
  }

  /* Pass 2: Local voter file (FL / NC / OH). Phonetic fallback baked in. */
  if ((!result.owner_name || !result.phone) && ctx.state && ctx.zip) {
    const voterLocal = await trace("voter_file_local", () =>
      lookupLocalVoterFile({
        state: ctx.state!,
        address: ctx.address,
        zip: ctx.zip!,
        lastName: result.owner_last ?? undefined,
      }),
    );
    if (voterLocal) {
      applyField(result, "owner_name", voterLocal.owner_name, voterLocal.source);
      applyField(result, "phone", voterLocal.phone, voterLocal.source);
      if (!result.primary_source && voterLocal.owner_name) {
        result.primary_source = voterLocal.source;
        result.confidence = Math.max(result.confidence, voterLocal.confidence);
      }
    }
  }

  /* Pass 2.5: PPP loan database (SQL only, once ingested).
   * Try matching by business name first (high-value contractor-side
   * enrichment), then by address (catches sole-proprietors who used
   * their home as the business address). */
  const businessNameEarly = ctx.contractor_name ?? ctx.applicant_name ?? null;
  if ((!result.owner_name || !result.phone) && (businessNameEarly || ctx.zip)) {
    const ppp = await trace("ppp_sba", () =>
      lookupPPP({
        businessName: businessNameEarly ?? undefined,
        address: ctx.address,
        zip: ctx.zip ?? undefined,
        stateCode: ctx.state ?? undefined,
      }),
    );
    if (ppp) {
      applyField(result, "owner_name", ppp.owner_name, ppp.source);
      applyField(result, "owner_first", ppp.owner_first, ppp.source);
      applyField(result, "owner_last", ppp.owner_last, ppp.source);
      applyField(result, "phone", ppp.business_phone, ppp.source);
      applyField(result, "mailing_address", ppp.business_address, ppp.source);
      if (!result.primary_source && ppp.owner_name) {
        result.primary_source = ppp.source;
        result.confidence = Math.max(result.confidence, ppp.confidence);
      }
    }
  }

  /* ── Phase B: parallel independent external lookups ────────────────
   *
   * Passes 3–6 hit four separate external endpoints (county GIS, Regrid,
   * contractor-license board, OpenCorporates). None of them reads the
   * others' output, so we can fire them all concurrently and merge
   * the results after they settle. Drops enrichLead latency from
   * sum-of-4-calls to max-of-4-calls — typically a 2-4x speedup when
   * multiple sources are live.
   *
   * Merge order below mirrors the sequential order we had before, so
   * downstream state (which-source-got-there-first for `primary_source`)
   * is identical to the serial version. Safe swap-in.
   *
   * Each pass is conditionally gated — we STILL skip county if we
   * already have year_built from upstream, skip Regrid unless thin,
   * etc. The gates live inside each lambda below so we don't pay the
   * network cost unless we need the data.
   */
  const businessName = ctx.contractor_name ?? ctx.applicant_name ?? null;
  const thinEnoughForRegrid =
    !result.owner_name && !result.year_built && !result.home_sqft;
  const needsBizPhone = !result.phone && !!businessName;

  const [countyHit, regridHit, licenseHit, ocHit, googleHit, yelpHit, osmHit] =
    await Promise.all([
      // County GIS — always runs when we have an address.
      trace("county_gis", () =>
        enrichFromCounty(
          ctx.state ?? null,
          ctx.city ?? null,
          ctx.address,
          ctx.zip ?? null,
        ),
      ),
      // Regrid — gated on initial thinness. queryRegrid itself no-ops
      // without the API key, so the cost when disabled is 0.
      thinEnoughForRegrid
        ? trace("regrid", () => queryRegrid(ctx.address, ctx.zip ?? null))
        : Promise.resolve(null),
      // Contractor license board — gated on business name + state.
      businessName && ctx.state && !result.phone
        ? trace("contractor_license", () =>
            lookupContractorLicense(businessName, ctx.state!),
          )
        : Promise.resolve(null),
      // OpenCorporates — gated on business name. Gate strictly on
      // owner_name still-null (500/day free tier is precious).
      businessName && !result.owner_name
        ? trace("opencorporates", () =>
            lookupCompanyPrincipal(businessName, ctx.state),
          )
        : Promise.resolve(null),
      // Google Places — gated on business-name-needing-phone. Prefer
      // Google over Yelp (broader dataset, newer). Skips automatically
      // when no API key or quota exhausted.
      needsBizPhone
        ? trace("google_places", () =>
            lookupGooglePlaces({
              businessName: businessName!,
              city: ctx.city,
              state: ctx.state,
              zip: ctx.zip,
            }),
          )
        : Promise.resolve(null),
      // Yelp — redundant only if Google already populated phone in
      // this parallel bundle. Can't know in advance, so we run it
      // concurrently; it's cheap, and Yelp sometimes has phones
      // Google doesn't.
      needsBizPhone
        ? trace("yelp", () =>
            lookupYelp({
              businessName: businessName!,
              city: ctx.city,
              state: ctx.state,
              zip: ctx.zip,
            }),
          )
        : Promise.resolve(null),
      // OSM contact metadata — not just year_built (county-gis.ts
      // already handles that). Pulls contact:phone / contact:email /
      // website / operator for commercial buildings tagged in OSM.
      // Thin gate: always run when we need any contact field.
      !result.phone || !result.email
        ? trace("osm_contact", () =>
            lookupOSMContact({
              address: ctx.address,
              city: ctx.city,
              state: ctx.state,
              zip: ctx.zip,
            }),
          )
        : Promise.resolve(null),
    ]);

  /* Merge county (runs first in priority). */
  if (countyHit) {
    applyField(result, "owner_name", countyHit.owner_name, countyHit.source);
    applyField(result, "owner_first", countyHit.owner_first, countyHit.source);
    applyField(result, "owner_last", countyHit.owner_last, countyHit.source);
    applyField(result, "mailing_address", countyHit.mailing_address, countyHit.source);
    applyField(result, "year_built", countyHit.year_built, countyHit.source);
    applyField(result, "home_sqft", countyHit.home_sqft, countyHit.source);
    applyField(result, "lot_sqft", countyHit.lot_sqft, countyHit.source);
    applyField(result, "assessed_value", countyHit.assessed_value, countyHit.source);
    applyField(result, "property_value", countyHit.property_value, countyHit.source);
    applyField(result, "owner_occupied", countyHit.owner_occupied, countyHit.source);
    applyField(result, "last_sale_date", countyHit.last_sale_date, countyHit.source);
    applyField(result, "last_sale_price", countyHit.last_sale_price, countyHit.source);
    if (!result.primary_source && countyHit.owner_name) {
      result.primary_source = countyHit.source;
      result.confidence = Math.max(result.confidence, 0.9);
    }
  }

  /* Merge Regrid (nationwide fallback for property data). */
  if (regridHit) {
    applyField(result, "owner_name", regridHit.owner_name, regridHit.source);
    applyField(result, "mailing_address", regridHit.mailing_address, regridHit.source);
    applyField(result, "year_built", regridHit.year_built, regridHit.source);
    applyField(result, "home_sqft", regridHit.home_sqft, regridHit.source);
    applyField(result, "lot_sqft", regridHit.lot_sqft, regridHit.source);
    applyField(result, "assessed_value", regridHit.assessed_value, regridHit.source);
    applyField(result, "property_value", regridHit.property_value, regridHit.source);
    applyField(result, "last_sale_date", regridHit.last_sale_date, regridHit.source);
    applyField(result, "last_sale_price", regridHit.last_sale_price, regridHit.source);
  }

  /* Merge contractor-license (business phone + license holder). */
  if (licenseHit) {
    applyField(result, "phone", licenseHit.business_phone, licenseHit.source);
    applyField(result, "mailing_address", licenseHit.business_address, licenseHit.source);
    if (!result.owner_name && licenseHit.license_holder_name) {
      applyField(result, "owner_name", licenseHit.license_holder_name, licenseHit.source);
      applyField(result, "owner_first", licenseHit.license_holder_first, licenseHit.source);
      applyField(result, "owner_last", licenseHit.license_holder_last, licenseHit.source);
    }
  }

  /* Merge OpenCorporates (LLC → principal). */
  if (ocHit?.owner_name) {
    applyField(result, "owner_name", ocHit.owner_name, ocHit.source);
    applyField(result, "owner_first", ocHit.owner_first, ocHit.source);
    applyField(result, "owner_last", ocHit.owner_last, ocHit.source);
    if (!result.primary_source) {
      result.primary_source = ocHit.source;
      result.confidence = Math.max(result.confidence, ocHit.confidence);
    }
  }

  /* Merge Google Places (business phone / address / website). */
  if (googleHit) {
    applyField(result, "phone", googleHit.business_phone, googleHit.source);
    applyField(result, "mailing_address", googleHit.business_address, googleHit.source);
  }

  /* Merge Yelp (business phone backfill when Google was thin). */
  if (yelpHit) {
    applyField(result, "phone", yelpHit.business_phone, yelpHit.source);
    applyField(result, "mailing_address", yelpHit.business_address, yelpHit.source);
  }

  /* Merge OSM contact metadata. Commercial buildings with contact tags
   * often have phone + email tagged; residential usually just year_built
   * (which the county-gis pass already handles, but OSM can fill gaps
   * outside our 22 covered metros). */
  if (osmHit) {
    applyField(result, "phone", osmHit.phone, osmHit.source);
    applyField(result, "email", osmHit.email, osmHit.source);
    applyField(result, "year_built", osmHit.year_built, osmHit.source);
    // OSM operator tag = business owner for commercial entities.
    if (!result.owner_name && osmHit.owner_name) {
      applyField(result, "owner_name", osmHit.owner_name, osmHit.source);
    }
  }

  /* ── Pass 7: FEC contributor (gated) ───────────────────────────── */
  if (result.owner_first && result.owner_last) {
    const fec: FECContributorResult | null = await lookupFECContributor({
      firstName: result.owner_first,
      lastName: result.owner_last,
      zip: ctx.zip,
      stateCode: ctx.state,
    });
    if (fec) {
      applyField(result, "employer", fec.employer, fec.source);
      applyField(result, "occupation", fec.occupation, fec.source);
      // If FEC confirms the mailing address, adopt it — authoritative
      // federal-disclosure record.
      if (!result.mailing_address && fec.residence_address) {
        applyField(
          result,
          "mailing_address",
          [fec.residence_address, fec.residence_city, fec.residence_state, fec.residence_zip]
            .filter(Boolean)
            .join(", "),
          fec.source,
        );
      }
    }
  }

  /* ── Phase D: parallel terminal lookups ────────────────────────────
   *
   * Voter-reg and Hunter both need inputs from Phase B / C (owner_last
   * and businessName respectively). They're independent of each other
   * so we run them in parallel. On a typical enrichment with all keys
   * set this cuts another ~800ms off the tail.
   */
  // Hunter gate (tightened 2026-05-05): Hunter.io's free tier is 25
  // searches/mo. The previous gate `!result.email && businessName` fired
  // on every enrichable lead, including homeowner permits where
  // `applicant_name` is the homeowner's personal name (Hunter treats it
  // as a "business name" and burns a search returning nothing). Two
  // hard gates now:
  //   1. applicant_classification === "contractor"  — only contractor
  //      permits, never homeowner DIY.
  //   2. ctx.contractor_name (not the applicant_name fallback) — only
  //      when we have a real company name to look up a domain for.
  // Together these cut Hunter calls by ~95% so the 25/mo budget lasts.
  const hunterShouldFire =
    !result.email &&
    ctx.applicant_classification === "contractor" &&
    !!ctx.contractor_name;
  const [voterHit, emailHit] = await Promise.all([
    !result.phone && ctx.state && result.owner_last && ctx.zip
      ? trace("voter_reg_vendor", () =>
          lookupVoterByAddress(ctx.state!, ctx.address, ctx.zip!, result.owner_last!),
        )
      : Promise.resolve(null),
    hunterShouldFire
      ? trace("hunter_io", () =>
          inferEmailFromBusinessName(ctx.contractor_name!, result.owner_first, result.owner_last),
        )
      : Promise.resolve(null),
  ]);

  if (voterHit?.phone) {
    applyField(result, "phone", voterHit.phone, voterHit.source);
    if (!result.owner_name && voterHit.owner_name) {
      applyField(result, "owner_name", voterHit.owner_name, voterHit.source);
    }
  }
  if (emailHit?.email) {
    applyField(result, "email", emailHit.email, "hunter_io");
  }

  /* ── Phase E: free-tier validation + weather context ─────────────────
   *
   * Three sources added 2026-04-26 — all free-tier-budgeted, all gated
   * on env presence. Run in parallel; null on any failure (graceful
   * degrade per CLAUDE.md). Each is independently cached; rerunning
   * the orchestrator on the same lead within the cache TTL is a no-op.
   *
   * - Numverify (100/mo) — phone validation + line type
   * - Cloudmersive (800/mo) — fallback phone validation + address normalization
   * - WeatherStack (100/mo) — weather context per ZIP
   *
   * Source order on phone validation: try Numverify first (lower
   * quota means we run out faster, which means caller should know
   * to re-budget). Cloudmersive is the higher-quota fallback.
   */
  // Apollo gate — only fires when the permit applicant is classified as a
  // contractor/business AND we still don't have email or phone after every
  // free-tier source has run. Cost-conscious: ~5% of permits at full scale.
  const apolloBusinessName = ctx.contractor_name ?? ctx.applicant_name ?? null;
  const apolloShouldFire =
    ctx.applicant_classification === "contractor" &&
    !!apolloBusinessName &&
    (!result.email || !result.phone);

  if (result.phone || ctx.zip || ctx.address || apolloShouldFire) {
    const [phoneNumverify, phoneCloudmersive, addressNormalized, weather, apollo] =
      await Promise.all([
        result.phone
          ? trace("numverify", () =>
              import("./numverify").then((m) => m.lookupPhoneMetadata(result.phone!)),
            )
          : Promise.resolve(null),
        result.phone
          ? trace("cloudmersive_phone", () =>
              import("./cloudmersive").then((m) =>
                m.lookupPhoneCloudmersive(result.phone!),
              ),
            )
          : Promise.resolve(null),
        ctx.address
          ? trace("cloudmersive_address", () =>
              import("./cloudmersive").then((m) =>
                m.lookupAddressCloudmersive(
                  `${ctx.address}, ${ctx.city ?? ""} ${ctx.state ?? ""} ${ctx.zip ?? ""}`.trim(),
                ),
              ),
            )
          : Promise.resolve(null),
        ctx.zip
          ? trace("weatherstack", () =>
              import("./weatherstack").then((m) => m.lookupWeatherByZip(ctx.zip!)),
            )
          : Promise.resolve(null),
        apolloShouldFire
          ? trace("apollo", () =>
              import("./apollo").then((m) =>
                m.lookupBusinessPrincipal({
                  businessName: apolloBusinessName!,
                  state: ctx.state,
                  zip: ctx.zip,
                }),
              ),
            )
          : Promise.resolve(null),
      ]);

    // Phone metadata: Numverify wins on tie (more detailed line-type info)
    const phoneMeta = phoneNumverify ?? phoneCloudmersive;
    if (phoneMeta) {
      const lt =
        "line_type" in phoneMeta
          ? phoneMeta.line_type
          : "type" in phoneMeta
            ? phoneMeta.type
            : null;
      const valid = phoneMeta.valid ?? null;
      const carrier = "carrier" in phoneMeta ? phoneMeta.carrier : null;
      applyField(result, "phone_line_type", lt, phoneMeta.source);
      applyField(result, "phone_valid", valid, phoneMeta.source);
      applyField(result, "phone_carrier", carrier, phoneMeta.source);
      // Strategy: only Numverify pre-computes; for Cloudmersive derive on the fly
      if ("outreach_strategy" in phoneMeta) {
        applyField(result, "phone_strategy", phoneMeta.outreach_strategy, phoneMeta.source);
      } else if (valid) {
        const strategy =
          lt === "mobile"
            ? "sms-preferred"
            : lt === "landline"
              ? "voice-preferred"
              : "either";
        applyField(result, "phone_strategy", strategy, phoneMeta.source);
      } else {
        applyField(result, "phone_strategy", "skip", phoneMeta.source);
      }
    }

    // Address normalization
    if (addressNormalized) {
      applyField(
        result,
        "address_normalized",
        addressNormalized.normalized,
        "cloudmersive",
      );
    }

    // Weather context
    if (weather) {
      applyField(result, "weather_severity", weather.severity, "weatherstack");
      applyField(result, "weather_hazards", weather.hazards, "weatherstack");
    }

    // Apollo (contractor-only B2B contact) — only ever fires when
    // applicant_classification === "contractor" so we don't burn credits
    // on homeowner-pulled permits. Apollo's email is usually verified work
    // email; phone is usually direct/mobile. Both are higher-quality than
    // OpenCorporates' principal-name-only result.
    if (apollo) {
      applyField(result, "owner_name", apollo.owner_name, apollo.source);
      applyField(result, "owner_first", apollo.owner_first, apollo.source);
      applyField(result, "owner_last", apollo.owner_last, apollo.source);
      applyField(result, "email", apollo.email, apollo.source);
      applyField(result, "phone", apollo.phone, apollo.source);
      if (!result.primary_source && apollo.owner_name) {
        result.primary_source = apollo.source;
        result.confidence = Math.max(result.confidence, apollo.confidence);
      }
    }
  }

  /* ── Aggregate confidence ──────────────────────────────────────────────
   *
   * The score that gets persisted into `leads.contact_confidence` and used
   * by the 6-signal scorer's `contact_completeness` weight. Cross-source
   * agreement is the strongest signal: when two or more independent free-
   * tier sources name the same homeowner, we know the data is right.
   *
   * Algorithm:
   *   1. Count how many distinct sources contributed each critical field
   *      (owner_name, phone, email).
   *   2. Apply per-field floors when agreement thresholds are met.
   *   3. Keep the existing breadth bonus (≥3 distinct sources overall)
   *      as a tiebreaker for leads where no single field saw multi-source
   *      agreement but many fields were filled across the pipeline.
   *
   * The "agreement" check is implemented as: does a field's primary source
   * match what a SECONDARY source ALSO would have written? Today we only
   * track the winner per field via `applyField`, so we approximate
   * agreement by counting whether 2+ different non-upstream sources
   * contributed any data ABOUT THAT FIELD's row (via owner_first/last
   * sub-fields). This is the same pattern the audit at
   * `docs/audits/2026-04-26/06-data-correctness.md` recommended.
   */

  // Aggregate distinct sources across the whole result (excluding upstream
  // since that's literally just "what the caller passed in"; not an
  // independent agreement signal).
  const distinctSources = new Set(
    Object.values(result.sources).filter((s) => s !== "upstream"),
  );

  // Per-field source-count helpers. We count the source attribution for
  // owner_name AND its sub-fields owner_first / owner_last. If three of
  // those came from DIFFERENT sources, three sources independently named
  // the same person — strong agreement.
  const ownerSources = new Set(
    [result.sources.owner_name, result.sources.owner_first, result.sources.owner_last]
      .filter((s): s is string => !!s && s !== "upstream"),
  );
  const phoneSources = new Set(
    [result.sources.phone].filter((s): s is string => !!s && s !== "upstream"),
  );

  // Floor 1: 3+ distinct sources naming the same owner → 0.95 floor.
  // This is the gold standard — when county GIS, voter file, and Apollo
  // all name "John Smith" at this address, we're confident.
  if (ownerSources.size >= 3) {
    result.confidence = Math.max(result.confidence, 0.95);
  }

  // Floor 2: 2+ distinct sources confirming a phone → 0.85 floor.
  // Less common (most leads only get one phone hit) but powerful when it
  // happens — e.g. Numverify + Cloudmersive both validate the same number.
  if (phoneSources.size >= 2) {
    result.confidence = Math.max(result.confidence, 0.85);
  }

  // Breadth bonus (kept from the prior implementation): 3+ distinct
  // sources contributing ANY field → +0.05. Recognizes leads where many
  // small signals aligned across the pipeline even if no single field
  // saw direct multi-source agreement.
  if (distinctSources.size >= 3) {
    result.confidence = Math.min(1, result.confidence + 0.05);
  }

  cacheSet(key, result);
  return result;
}
