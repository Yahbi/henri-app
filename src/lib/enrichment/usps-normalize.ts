/**
 * USPS Address Normalization (ZIP+4 Lookup)
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: given a messy address like "123 main st" / "123 Main Street"
 * / "123 Main St.", get back the USPS-canonical form: "123 MAIN ST",
 * ZIP+4 appended, delivery-point validation status. The canonical form
 * is the KEY we use to dedup and cross-reference between voter files,
 * FEC records, county assessor rolls, and our own permits table.
 *
 * Without normalization, the SAME physical address appears dozens of
 * ways across sources. A voter file might have "123 MAIN STREET APT 4",
 * FEC has "123 Main St #4", the permit has "123 MAIN ST". Our
 * cross-reference joins miss all of these. USPS normalization
 * collapses them to one canonical key.
 *
 * ## USPS Web Tools API (free)
 *
 *   - Register for a Web Tools user ID:
 *     https://registration.shippingapis.com/
 *   - Free. No per-day limits documented for Address Validation Tool.
 *   - XML-in, XML-out API. We use the `Verify` endpoint which takes up
 *     to 5 addresses per call.
 *
 * Gating: module is a no-op unless `USPS_USER_ID` is set.
 *
 * ## When to call this
 *
 * NOT inline per-lead during enrichment — USPS is slower than needed
 * (~500ms per call). Instead:
 *   - Call once per NEW permit at ingest time to cache the
 *     canonical form on the permit row itself (requires a new
 *     `permit.normalized_address` column — migration future-work).
 *   - Call from an explicit normalization cron if we want to backfill
 *     the canonical form on existing permits.
 *
 * For the cron enricher, we use a cheaper in-JS heuristic
 * (`normalizeAddress` from scripts/correlate-enrichment.ts) that gets
 * us 80% of the way there without any network round-trip.
 *
 * ## Failure modes
 *
 * All return null. Never throws. USPS has been occasionally flaky on
 * the free Web Tools endpoint; graceful-degrade is essential.
 */

import { logger } from "@/lib/logger";

const USPS_BASE = "https://secure.shippingapis.com/ShippingAPI.dll";
const REQUEST_TIMEOUT_MS = 5_000;

export interface USPSNormalizedAddress {
  address_1: string;         // street
  address_2: string | null;  // apt / ste / unit
  city: string;
  state: string;
  zip5: string;
  zip_plus_4: string | null;
  /** USPS delivery-point valid (DPV) — the address is deliverable.
   *  When false, the address exists as a range but has no specific
   *  delivery point; treat as provisional. */
  dpv_confirmation: "Y" | "N" | "S" | "D" | null;
  canonical_key: string;     // "123 MAIN ST|94520" — for dedup/join
}

/** Simple XML escape for our own tag content. USPS XML input is tightly
 *  scoped so full XML encoding isn't required, but we guard for &, <, >. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Shallow XML-tag extractor. We deliberately don't pull in an XML
 *  parser dep — the USPS response shape is stable and nested only two
 *  levels. Returns the first occurrence of <Tag>...</Tag>. */
function extract(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

export async function normalizeAddress(input: {
  address1: string;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<USPSNormalizedAddress | null> {
  const uspsId = process.env.USPS_USER_ID;
  if (!uspsId) return null;

  const addr1 = input.address1?.trim();
  if (!addr1) return null;

  // Build the XML payload. USPS's Verify endpoint accepts Address2 as
  // the street line and Address1 as the apt/unit line — counterintuitive
  // but documented. Reference: https://www.usps.com/business/web-tools-apis/address-information-api.htm
  const xmlPayload =
    `<AddressValidateRequest USERID="${xmlEscape(uspsId)}">` +
    `<Revision>1</Revision>` +
    `<Address ID="0">` +
    `<Address1>${xmlEscape(input.address2 ?? "")}</Address1>` +
    `<Address2>${xmlEscape(addr1)}</Address2>` +
    `<City>${xmlEscape(input.city ?? "")}</City>` +
    `<State>${xmlEscape(input.state ?? "")}</State>` +
    `<Zip5>${xmlEscape((input.zip ?? "").slice(0, 5))}</Zip5>` +
    `<Zip4></Zip4>` +
    `</Address>` +
    `</AddressValidateRequest>`;

  const url = `${USPS_BASE}?API=Verify&XML=${encodeURIComponent(xmlPayload)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();

    // USPS returns 200 with an <Error> block on failure — check explicitly.
    if (text.includes("<Error>")) {
      const desc = extract(text, "Description");
      logger.warn("usps validation error", { desc });
      return null;
    }

    const address2 = extract(text, "Address2"); // canonical street
    const apt = extract(text, "Address1");      // canonical apt
    const city = extract(text, "City");
    const state = extract(text, "State");
    const zip5 = extract(text, "Zip5");
    const zip4 = extract(text, "Zip4");
    const dpvRaw = extract(text, "DPVConfirmation");

    if (!address2 || !city || !state || !zip5) return null;

    const dpv = (dpvRaw as "Y" | "N" | "S" | "D" | null) ?? null;

    return {
      address_1: address2.toUpperCase(),
      address_2: apt ? apt.toUpperCase() : null,
      city: city.toUpperCase(),
      state: state.toUpperCase(),
      zip5,
      zip_plus_4: zip4 || null,
      dpv_confirmation: dpv,
      // Canonical key for cross-reference joins. Same format the
      // correlate-enrichment script uses so the two are interoperable.
      canonical_key: `${address2.toUpperCase()}|${zip5}`,
    };
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name !== "AbortError") {
      logger.warn("usps fetch failed", { error: (e as Error).message });
    }
    return null;
  }
}

/** Cheap in-JS normalizer for cases where we don't want a USPS
 *  round-trip. Matches the normalizer in `scripts/correlate-
 *  enrichment.ts` so the canonical keys line up between passes. */
export function normalizeAddressLocal(
  addr: string | null | undefined,
  zip?: string | null,
): string | null {
  if (!addr) return null;
  const a = addr
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    // Common street-suffix canonicalization. We don't try to handle all
    // USPS standard suffixes (there are ~200); just the top ~20.
    .replace(/\b(STREET)\b/g, "ST")
    .replace(/\b(AVENUE)\b/g, "AVE")
    .replace(/\b(BOULEVARD)\b/g, "BLVD")
    .replace(/\b(DRIVE)\b/g, "DR")
    .replace(/\b(ROAD)\b/g, "RD")
    .replace(/\b(LANE)\b/g, "LN")
    .replace(/\b(COURT)\b/g, "CT")
    .replace(/\b(PLACE)\b/g, "PL")
    .replace(/\b(CIRCLE)\b/g, "CIR")
    .replace(/\b(TERRACE)\b/g, "TER")
    .replace(/\b(HIGHWAY)\b/g, "HWY")
    .replace(/\b(PARKWAY)\b/g, "PKWY");
  return zip ? `${a}|${zip}` : a;
}
