/* ── Property enrichment types ───────────────────────────────────────────── */

export interface EnrichmentResult {
  property_value: number | null;
  assessed_value: number | null;
  year_built: number | null;
  lot_sqft: string | null;
  home_sqft: string | null;
  owner_name: string | null;
  co_owner: string | null;
  owner_since: string | null;
  owner_occupied: boolean | null;
  mailing_address: string | null;
  apn: string | null;
  source: string;
}

export interface AssessorSource {
  id: string;
  label: string;
  type: "socrata" | "arcgis";
  domain: string;
  datasetId: string;
  /** County FIPS codes this source covers */
  countyFips: string[];
  /** State abbreviation */
  state: string;
  /** Field mapping from assessor columns to our fields */
  fieldMap: AssessorFieldMap;
}

export interface AssessorFieldMap {
  /** Column for property situs/site address */
  address: string;
  /** Column for assessed/appraised value */
  assessed_value?: string;
  /** Column for market/property value */
  property_value?: string;
  /** Column for year built */
  year_built?: string;
  /** Column for lot size (sqft or acres) */
  lot_sqft?: string;
  /** Is lot_sqft in acres? If true, will convert to sqft */
  lot_in_acres?: boolean;
  /** Column for building/living area sqft */
  home_sqft?: string;
  /** Column for owner name */
  owner_name?: string;
  /** Column for co-owner name */
  co_owner?: string;
  /** Column for mailing/billing address */
  mailing_address?: string;
  /** Column for sale/purchase date */
  sale_date?: string;
  /** Column for APN / parcel number */
  apn?: string;
}

export interface EnrichmentQuery {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
}
