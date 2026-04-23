import type { AssessorSource } from "./types";

/**
 * County assessor data sources — all free, public Socrata/ArcGIS APIs.
 * Each source maps to a specific county and provides property details
 * (value, year built, lot/home sqft, owner info, mailing address).
 */
export const ASSESSOR_SOURCES: AssessorSource[] = [
  /* ── Los Angeles County ─────────────────────────────────────────────────── */
  {
    id: "la_county",
    label: "LA County Assessor",
    type: "socrata",
    domain: "data.lacounty.gov",
    datasetId: "9trm-uz8i",
    countyFips: ["06037"], // Los Angeles County, CA
    state: "CA",
    fieldMap: {
      address: "propertylocation",
      assessed_value: "totassessedvalue",
      property_value: "roll_totlandimp",
      year_built: "yearbuilt",
      lot_sqft: "sqftmain",
      home_sqft: "sqftmain",
      owner_name: "ownername1",
      co_owner: "ownername2",
      mailing_address: "mailingaddress",
      sale_date: "recordingdate",
      apn: "ain",
    },
  },

  /* ── Cook County (Chicago) ──────────────────────────────────────────────── */
  {
    id: "cook_county",
    label: "Cook County Assessor",
    type: "socrata",
    domain: "datacatalog.cookcountyil.gov",
    datasetId: "c49d-89sn",
    countyFips: ["17031"], // Cook County, IL
    state: "IL",
    fieldMap: {
      address: "property_address",
      assessed_value: "certified_tot",
      year_built: "age",
      lot_sqft: "land_square_footage",
      home_sqft: "building_square_footage",
      owner_name: "taxpayer_name",
      mailing_address: "taxpayer_mailing_address",
      apn: "pin",
    },
  },

  /* ── NYC PLUTO ──────────────────────────────────────────────────────────── */
  {
    id: "nyc_pluto",
    label: "NYC PLUTO",
    type: "socrata",
    domain: "data.cityofnewyork.us",
    datasetId: "64uk-42ks",
    countyFips: ["36061", "36047", "36081", "36005", "36085"], // Manhattan, Brooklyn, Queens, Bronx, Staten Island
    state: "NY",
    fieldMap: {
      address: "address",
      assessed_value: "assesstot",
      property_value: "fullval",
      year_built: "yearbuilt",
      lot_sqft: "lotarea",
      home_sqft: "bldgarea",
      owner_name: "ownername",
      apn: "bbl",
    },
  },

  /* ── King County (Seattle) ──────────────────────────────────────────────── */
  {
    id: "king_county",
    label: "King County Assessor",
    type: "socrata",
    domain: "data.kingcounty.gov",
    datasetId: "jyb3-bfkn",
    countyFips: ["53033"], // King County, WA
    state: "WA",
    fieldMap: {
      address: "address",
      assessed_value: "apprtotval",
      year_built: "yrbuilt",
      lot_sqft: "lotsqft",
      home_sqft: "sqfttotliving",
      owner_name: "taxpayer",
      apn: "major",
    },
  },

  /* ── Travis County (Austin) ─────────────────────────────────────────────── */
  {
    id: "travis_county",
    label: "Travis County Appraisal",
    type: "socrata",
    domain: "data.traviscountytx.gov",
    datasetId: "csmq-9krh",
    countyFips: ["48453"], // Travis County, TX
    state: "TX",
    fieldMap: {
      address: "situs_address",
      assessed_value: "appraised_val",
      property_value: "market_val",
      year_built: "year_built",
      lot_sqft: "land_acres",
      lot_in_acres: true,
      home_sqft: "living_area",
      owner_name: "owner_name",
      mailing_address: "mailing_address",
      apn: "prop_id",
    },
  },

  /* ── Hamilton County (Cincinnati) ───────────────────────────────────────── */
  {
    id: "hamilton_county",
    label: "Hamilton County Auditor",
    type: "socrata",
    domain: "data.hamilton-co.org",
    datasetId: "3w3n-t9dn",
    countyFips: ["39061"], // Hamilton County, OH
    state: "OH",
    fieldMap: {
      address: "propertyaddress",
      assessed_value: "totalappraised",
      year_built: "yearbuilt",
      lot_sqft: "acreage",
      lot_in_acres: true,
      home_sqft: "finishedlivingarea",
      owner_name: "ownernameprimary",
      mailing_address: "owneraddress1",
      apn: "parcelnumber",
    },
  },

  /* ── San Francisco ──────────────────────────────────────────────────────── */
  {
    id: "sf_county",
    label: "SF Assessor-Recorder",
    type: "socrata",
    domain: "data.sfgov.org",
    datasetId: "wv5m-vpq2",
    countyFips: ["06075"], // San Francisco County, CA
    state: "CA",
    fieldMap: {
      address: "property_location",
      assessed_value: "assessedlandval",
      property_value: "assessedimprovementval",
      year_built: "yearbuilt",
      lot_sqft: "lotarea",
      home_sqft: "livingarea",
      owner_name: "ownernameprimary",
      mailing_address: "owneraddress",
      apn: "parcelnum",
    },
  },

  /* ── Denver ─────────────────────────────────────────────────────────────── */
  {
    id: "denver_county",
    label: "Denver Assessor",
    type: "socrata",
    domain: "data.denvergov.org",
    datasetId: "wak2-cejk",
    countyFips: ["08031"], // Denver County, CO
    state: "CO",
    fieldMap: {
      address: "situs_address",
      assessed_value: "assessed_value",
      property_value: "actual_value",
      year_built: "year_built",
      lot_sqft: "land_sqft",
      home_sqft: "total_sqft",
      owner_name: "owner_name",
      mailing_address: "owner_address",
      apn: "schedule_number",
    },
  },
];

/**
 * Look up which assessor source covers a given county FIPS code.
 */
export function findAssessorByFips(countyFips: string): AssessorSource | null {
  return ASSESSOR_SOURCES.find((s) => s.countyFips.includes(countyFips)) ?? null;
}

/**
 * Look up which assessor source might cover a given state + city.
 * Falls back to first match by state.
 */
export function findAssessorByState(state: string): AssessorSource | null {
  return ASSESSOR_SOURCES.find((s) => s.state === state) ?? null;
}
