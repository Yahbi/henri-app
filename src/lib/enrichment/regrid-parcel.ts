/**
 * Regrid Parcel Lookup — nationwide fallback (gated on REGRID_API_KEY)
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: nationwide parcel enrichment for addresses that fall outside our
 * 13+ jurisdiction-specific lookups in `county-gis.ts`. Regrid consolidates
 * parcel data from every US county into a single REST API — owner name,
 * year built, assessed value, mailing address, lot size, land use, etc. —
 * with reasonable coverage outside the metros we already cover.
 *
 * Positioning in the enrichment pipeline:
 *
 *   1. COUNTY_LOOKUPS[state][county]  — highest fidelity, free (this is
 *      queried first for the ~13 jurisdictions we've verified live).
 *   2. Regrid                          — nationwide fallback. Good quality
 *      but metered (~100/day free, paid tiers for higher volume). Fires
 *      only when the jurisdiction-specific lookup returned null.
 *   3. OpenStreetMap                   — last resort. Sparse but free.
 *
 * Why a gated scaffold (REGRID_API_KEY) instead of always-on:
 *
 *   - Free tier is ~100 req/day. At BATCH_SIZE=600 running every 30 min,
 *     the cron alone would blow the free allowance in one invocation.
 *     The gate lets us opt in once we're on a paid tier (or for targeted
 *     burst-enrich runs against the founder account).
 *
 *   - Regrid's ToS requires attribution on public-facing displays. We
 *     have to update the lead detail drawer / map legend before going
 *     fully live. Easier to land the code first + flip the switch once
 *     the UI attribution ships.
 *
 *   - Coverage per state still varies. Regrid is strong in TX/CA/NY/FL
 *     and thinner in rural states. A future refinement could narrow
 *     which states we bother querying, but for a 96%-owner-null baseline
 *     every hit is progress.
 *
 * Auth: query-string token. No bearer auth. Rate limits are enforced at
 * the account level, not per-request, so we rely on our cron's per-worker
 * REQ_INTERVAL_MS (500 ms) to stay well under any per-second burst cap.
 *
 * Response shape (trimmed to what we actually consume):
 *
 *   {
 *     parcels: { features: [{
 *       properties: {
 *         headline: "123 Main St, Springfield, IL",
 *         fields: {
 *           owner, mailadd, mail_city, mail_state, mail_zip,
 *           usecode, usedesc, parval, landval, improvval,
 *           bldg_sqft, lot_sqft, gisacre, yrblt,
 *           saledate, saleprice, ...
 *         }
 *       }
 *     }, ...] }
 *   }
 *
 * Failure modes — always return null on any of these, never throw:
 *   - Missing REGRID_API_KEY (module disabled)
 *   - Network / timeout / non-200 (transient)
 *   - Empty `parcels.features` (address not found)
 *   - Rate-limit response (429) — logged but silent to caller
 *
 * See `src/lib/enrichment/county-gis.ts` for the integration point.
 */

import { logger } from "@/lib/logger";
import type { ParcelHit } from "./county-gis";

const REGRID_ENDPOINT = "https://app.regrid.com/api/v1/parcels.json";
const REQUEST_TIMEOUT_MS = 8_000;

/** Trimmed shape of the Regrid parcel response. Only the fields we actually
 *  read are typed — the response has 50+ columns per parcel, most irrelevant
 *  to our enrichment schema. */
interface RegridParcelFields {
  owner?: string | null;
  mailadd?: string | null;
  mail_city?: string | null;
  mail_state2?: string | null;
  mail_zip?: string | null;
  /** Assessed total value (for tax purposes). */
  parval?: number | string | null;
  /** Land-only value. */
  landval?: number | string | null;
  /** Improvement value. */
  improvval?: number | string | null;
  /** Finished building square feet. */
  bldg_sqft?: number | string | null;
  /** Lot size in square feet. */
  lot_sqft?: number | string | null;
  /** Lot size in acres (fallback when lot_sqft is null). */
  gisacre?: number | string | null;
  /** Year built (4-digit). */
  yrblt?: number | string | null;
  /** ISO date of last recorded sale. */
  saledate?: string | null;
  /** Last sale price in dollars. */
  saleprice?: number | string | null;
  /** Free-form use code description ("Single-family residence", etc.). */
  usedesc?: string | null;
  /** State FIPS — useful for debugging coverage holes. */
  state2?: string | null;
  county?: string | null;
}

interface RegridResponse {
  parcels?: {
    features?: Array<{
      properties?: {
        headline?: string;
        fields?: RegridParcelFields;
      };
    }>;
  };
  /** Some error responses have { error: "..." } at the top level. */
  error?: string;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toYear(v: unknown): number | null {
  const n = toNum(v);
  if (n == null) return null;
  // Regrid sometimes ships yrblt=0 for unknown — filter obviously wrong years.
  return n >= 1700 && n <= 2100 ? n : null;
}

function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function buildMailing(f: RegridParcelFields): string | null {
  const parts = [f.mailadd, f.mail_city, f.mail_state2, f.mail_zip]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Query Regrid for a parcel matching the given address. Returns null on
 * any failure mode — caller never needs to handle exceptions.
 *
 * @param address Street address. Pass the full "123 Main St, Springfield,
 *                IL 62704" form when available; Regrid's geocoder handles
 *                the tail automatically.
 * @param zip     Optional ZIP — not used in the query directly (Regrid
 *                ignores ZIP in favor of its own geocode), but kept on
 *                the signature for symmetry with other enrichers in case
 *                we later switch to the POIST endpoint which does use it.
 */
export async function queryRegrid(
  address: string,
  _zip?: string | null,
): Promise<ParcelHit | null> {
  // Graceful no-op: module is disabled without an API key.
  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) return null;

  const trimmed = (address ?? "").trim();
  if (!trimmed) return null;

  const url = `${REGRID_ENDPOINT}?query=${encodeURIComponent(trimmed)}&token=${encodeURIComponent(apiKey)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Henri Lead-Gen Platform (contact: y.abismuth@gmail.com)",
      },
    });
    clearTimeout(timer);

    if (res.status === 429) {
      // Rate-limited by Regrid. Log once per invocation — the caller
      // already knows to back off when cron results show 429s in quick
      // succession. Returning null keeps the rest of the batch flowing.
      logger.warn("regrid-parcel: 429 rate-limited — account quota exhausted");
      return null;
    }
    if (!res.ok) {
      // Transient / 4xx — not worth logging every failed address lookup.
      // Only log on the first failure per invocation would require state;
      // for now we eat it silently and rely on the cron's `missed` counter.
      return null;
    }

    const body = (await res.json()) as RegridResponse;

    if (body.error) {
      logger.warn("regrid-parcel: API error", { error: body.error });
      return null;
    }

    const feature = body.parcels?.features?.[0];
    const f = feature?.properties?.fields;
    if (!f) return null;

    // Owner_name only; Regrid doesn't split first/last (it's one string
    // like "SMITH, JOHN J" or "JOHN & MARY SMITH"). Leave the parsing to
    // downstream callers — business-name-parser handles both forms.
    const owner = typeof f.owner === "string" ? f.owner.trim() : null;

    const lotSqft = toNum(f.lot_sqft) ?? (
      toNum(f.gisacre) != null ? Math.round(toNum(f.gisacre)! * 43_560) : null
    );

    return {
      owner_name: owner || null,
      mailing_address: buildMailing(f),
      year_built: toYear(f.yrblt),
      home_sqft: toNum(f.bldg_sqft),
      lot_sqft: lotSqft,
      assessed_value: toNum(f.parval),
      property_value: toNum(f.improvval),
      last_sale_date: toIsoDate(f.saledate),
      last_sale_price: toNum(f.saleprice),
      source: `Regrid (${f.state2 ?? "?"}${f.county ? ` / ${f.county}` : ""})`,
    };
  } catch (e) {
    clearTimeout(timer);
    // AbortError = timeout; other errors = network. Both are transient.
    // Log at debug level so we don't drown the cron log on a bad internet.
    if ((e as Error).name !== "AbortError") {
      logger.warn("regrid-parcel: fetch failed", {
        error: (e as Error).message,
      });
    }
    return null;
  }
}
