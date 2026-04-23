/* ── Permit Data Sources ─────────────────────────────────────────────────────
 * Defines Socrata open-data endpoints for permit ingestion across US cities.
 * Each source maps dataset-specific column names to our normalised permit schema.
 * ────────────────────────────────────────────────────────────────────────── */

export type HenriTrade =
  | "roofing"
  | "hvac"
  | "plumbing"
  | "electrical"
  | "solar"
  | "painting"
  | "landscaping"
  | "foundation"
  | "general remodel"
  | "adu"
  | "windows"
  | "other";

export interface FieldMap {
  address: string;
  zip: string;
  latitude?: string;
  longitude?: string;
  permit_type?: string;
  permit_number?: string;
  permit_value?: string;
  owner_first?: string;
  owner_last?: string;
  owner_name?: string;
  description?: string;
  issued_date: string;
  /** Address component fields — used when address is split across columns */
  street_number?: string;
  street_direction?: string;
  street_name_field?: string;
}

export interface TradeKeyword {
  pattern: RegExp;
  trade: HenriTrade;
}

export interface PermitSource {
  id: string;
  domain: string;
  datasetId: string;
  city: string;
  state: string;
  zipPrefix: string[];
  fieldMap: FieldMap;
  tradeKeywords: TradeKeyword[];
}

/* ── Shared trade-keyword rules ──────────────────────────────────────────── */

const COMMON_TRADE_KEYWORDS: TradeKeyword[] = [
  { pattern: /\broof/i, trade: "roofing" },
  { pattern: /\bshingle/i, trade: "roofing" },
  { pattern: /\bhvac\b/i, trade: "hvac" },
  { pattern: /\bfurnace/i, trade: "hvac" },
  { pattern: /\bair.?condition/i, trade: "hvac" },
  { pattern: /\bheating/i, trade: "hvac" },
  { pattern: /\bcooling/i, trade: "hvac" },
  { pattern: /\bductwork/i, trade: "hvac" },
  { pattern: /\bplumb/i, trade: "plumbing" },
  { pattern: /\bsewer/i, trade: "plumbing" },
  { pattern: /\bwater.?heater/i, trade: "plumbing" },
  { pattern: /\bdrain/i, trade: "plumbing" },
  { pattern: /\belectri/i, trade: "electrical" },
  { pattern: /\bwiring/i, trade: "electrical" },
  { pattern: /\bpanel.?upgrade/i, trade: "electrical" },
  { pattern: /\bcircuit/i, trade: "electrical" },
  { pattern: /\bsolar/i, trade: "solar" },
  { pattern: /\bphotovoltaic/i, trade: "solar" },
  { pattern: /\bpv\s?system/i, trade: "solar" },
  { pattern: /\bpaint/i, trade: "painting" },
  { pattern: /\blandscap/i, trade: "landscaping" },
  { pattern: /\birrigation/i, trade: "landscaping" },
  { pattern: /\bfoundation/i, trade: "foundation" },
  { pattern: /\bslab/i, trade: "foundation" },
  { pattern: /\bfootings?\b/i, trade: "foundation" },
  { pattern: /\bremodel/i, trade: "general remodel" },
  { pattern: /\brenovati/i, trade: "general remodel" },
  { pattern: /\balteration/i, trade: "general remodel" },
  { pattern: /\bkitchen/i, trade: "general remodel" },
  { pattern: /\bbathroom/i, trade: "general remodel" },
  { pattern: /\badu\b/i, trade: "adu" },
  { pattern: /\baccessory.?dwelling/i, trade: "adu" },
  { pattern: /\bin.?law/i, trade: "adu" },
  { pattern: /\bwindow/i, trade: "windows" },
  { pattern: /\bglazing/i, trade: "windows" },
];

/* ── Source definitions ──────────────────────────────────────────────────── */

export const PERMIT_SOURCES: PermitSource[] = [
  /* 1 — Chicago */
  {
    id: "chicago",
    domain: "data.cityofchicago.org",
    datasetId: "ydr8-5enu",
    city: "Chicago",
    state: "IL",
    zipPrefix: ["606"],
    fieldMap: {
      address: "street_address",
      street_number: "street_number",
      street_direction: "street_direction",
      street_name_field: "street_name",
      zip: "contact_1_zipcode",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_",
      permit_value: "reported_cost",
      description: "work_description",
      owner_name: "contact_1_name",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 2 — Los Angeles */
  {
    id: "la",
    domain: "data.lacity.org",
    datasetId: "pi9x-tg5x",
    city: "Los Angeles",
    state: "CA",
    zipPrefix: ["900", "901", "902", "903", "904", "910", "911", "912", "913", "914"],
    fieldMap: {
      address: "primary_address",
      zip: "zip_code",
      latitude: "lat",
      longitude: "lon",
      permit_type: "permit_type",
      permit_number: "permit_nbr",
      permit_value: "valuation",
      description: "work_desc",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 3 — Seattle */
  {
    id: "seattle",
    domain: "cos-data.seattle.gov",
    datasetId: "76t5-zqzr",
    city: "Seattle",
    state: "WA",
    zipPrefix: ["981"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permitclass",
      permit_number: "application_permit_number",
      permit_value: "estprojectcost",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 4 — Austin */
  {
    id: "austin",
    domain: "datahub.austintexas.gov",
    datasetId: "3syk-w9eu",
    city: "Austin",
    state: "TX",
    zipPrefix: ["787", "786"],
    fieldMap: {
      address: "original_address",
      zip: "original_zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type_desc",
      permit_number: "permit_number",
      permit_value: "total_valuation",
      description: "work_class",
      issued_date: "issued_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 5 — NYC */
  {
    id: "nyc",
    domain: "data.cityofnewyork.us",
    datasetId: "rbx6-tga4",
    city: "New York",
    state: "NY",
    zipPrefix: ["100", "101", "102", "103", "104", "110", "111", "112", "113", "114", "116"],
    fieldMap: {
      address: "house_no",
      street_number: "house_no",
      street_name_field: "street_name",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "filing_reason",
      permit_number: "job_filing_number",
      permit_value: "estimated_job_costs",
      description: "job_description",
      owner_name: "owner_name",
      owner_first: "applicant_first_name",
      owner_last: "applicant_last_name",
      issued_date: "approved_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 6 — Dallas */
  {
    id: "dallas",
    domain: "www.dallasopendata.com",
    datasetId: "e7gq-4sah",
    city: "Dallas",
    state: "TX",
    zipPrefix: ["752", "751", "750", "753"],
    fieldMap: {
      address: "location_of_project",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "type_of_work",
      permit_number: "permit_num",
      permit_value: "est_cost_of_construction",
      description: "description_of_work",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 7 — Cincinnati */
  {
    id: "cincinnati",
    domain: "data.cincinnati-oh.gov",
    datasetId: "uhjb-xac9",
    city: "Cincinnati",
    state: "OH",
    zipPrefix: ["452"],
    fieldMap: {
      address: "originaladdress1",
      zip: "originalzip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permittypemapped",
      permit_number: "permitnum",
      permit_value: "estprojectcostdec",
      description: "description",
      issued_date: "issueddate",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 8 — New Orleans */
  {
    id: "new_orleans",
    domain: "data.nola.gov",
    datasetId: "72f9-bi28",
    city: "New Orleans",
    state: "LA",
    zipPrefix: ["701"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "project_value",
      description: "scope_of_work",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 9 — Fort Worth */
  {
    id: "fort_worth",
    domain: "data.fortworthtexas.gov",
    datasetId: "quz7-xnsy",
    city: "Fort Worth",
    state: "TX",
    zipPrefix: ["761", "760"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "description",
      issued_date: "issued_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 10 — Kansas City */
  {
    id: "kansas_city",
    domain: "data.kcmo.org",
    datasetId: "cwrz-29jm",
    city: "Kansas City",
    state: "MO",
    zipPrefix: ["641"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "type",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 11 — Cambridge MA */
  {
    id: "cambridge",
    domain: "data.cambridgema.gov",
    datasetId: "9qm7-wbdc",
    city: "Cambridge",
    state: "MA",
    zipPrefix: ["021"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "estimated_cost",
      description: "description",
      issued_date: "issued_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 12 — Honolulu */
  {
    id: "honolulu",
    domain: "data.honolulu.gov",
    datasetId: "4vab-c87q",
    city: "Honolulu",
    state: "HI",
    zipPrefix: ["968"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "estimated_cost",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 13 — San Francisco */
  {
    id: "san_francisco",
    domain: "data.sfgov.org",
    datasetId: "i98e-djp9",
    city: "San Francisco",
    state: "CA",
    zipPrefix: ["941"],
    fieldMap: {
      address: "street_address",
      zip: "zipcode",
      latitude: "location",
      longitude: "location",
      permit_type: "permit_type_definition",
      permit_number: "permit_number",
      permit_value: "estimated_cost",
      description: "description",
      issued_date: "issued_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 14 — Portland OR */
  {
    id: "portland",
    domain: "data.portland.gov",
    datasetId: "t9jx-7dn6",
    city: "Portland",
    state: "OR",
    zipPrefix: ["972"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "y",
      longitude: "x",
      permit_type: "type",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "work_description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 15 — Denver */
  {
    id: "denver",
    domain: "data.denvergov.org",
    datasetId: "p2kg-ytgh",
    city: "Denver",
    state: "CO",
    zipPrefix: ["802", "800", "801"],
    fieldMap: {
      address: "full_address",
      zip: "zip_code",
      latitude: "geo_lat",
      longitude: "geo_lon",
      permit_type: "permit_type_desc",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "work_description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 16 — Washington DC */
  {
    id: "washington_dc",
    domain: "opendata.dc.gov",
    datasetId: "awqx-zupu",
    city: "Washington",
    state: "DC",
    zipPrefix: ["200"],
    fieldMap: {
      address: "full_address",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "estimated_cost",
      description: "description_of_work",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 17 — Boston */
  {
    id: "boston",
    domain: "data.boston.gov",
    datasetId: "hfgw-p5wb",
    city: "Boston",
    state: "MA",
    zipPrefix: ["021"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "location",
      longitude: "location",
      permit_type: "permittype",
      permit_number: "permitnumber",
      permit_value: "estimated_cost",
      description: "description",
      issued_date: "issued_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 18 — Philadelphia */
  {
    id: "philadelphia",
    domain: "phl.carto.com",
    datasetId: "6kkz-wbpa",
    city: "Philadelphia",
    state: "PA",
    zipPrefix: ["191"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "lat",
      longitude: "lng",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "total_fee",
      description: "permit_description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 19 — Miami */
  {
    id: "miami",
    domain: "datahub-miamidade.opendata.arcgis.com",
    datasetId: "gkvr-fhgz",
    city: "Miami",
    state: "FL",
    zipPrefix: ["331", "330", "332", "333"],
    fieldMap: {
      address: "address",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "job_value",
      description: "scope_of_work",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 20 — Atlanta */
  {
    id: "atlanta",
    domain: "gis.atlantaga.gov",
    datasetId: "a4bv-m8jk",
    city: "Atlanta",
    state: "GA",
    zipPrefix: ["303"],
    fieldMap: {
      address: "address",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "construction_cost",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 21 — Minneapolis */
  {
    id: "minneapolis",
    domain: "opendata.minneapolismn.gov",
    datasetId: "wz5d-k34h",
    city: "Minneapolis",
    state: "MN",
    zipPrefix: ["554"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "description",
      issued_date: "issued_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 22 — Sacramento */
  {
    id: "sacramento",
    domain: "data.cityofsacramento.org",
    datasetId: "4gbq-n4rk",
    city: "Sacramento",
    state: "CA",
    zipPrefix: ["958", "957"],
    fieldMap: {
      address: "address",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "work_description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 23 — San Jose */
  {
    id: "san_jose",
    domain: "data.sanjoseca.gov",
    datasetId: "6s4j-rfp5",
    city: "San Jose",
    state: "CA",
    zipPrefix: ["951", "950"],
    fieldMap: {
      address: "address",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "description",
      issued_date: "issued_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 24 — Nashville */
  {
    id: "nashville",
    domain: "data.nashville.gov",
    datasetId: "3h5w-q8b7",
    city: "Nashville",
    state: "TN",
    zipPrefix: ["372", "371"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "mapped_location_latitude",
      longitude: "mapped_location_longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "const_cost",
      description: "purpose",
      issued_date: "date_issued",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 25 — Charlotte */
  {
    id: "charlotte",
    domain: "data.charlottenc.gov",
    datasetId: "jv49-rdb6",
    city: "Charlotte",
    state: "NC",
    zipPrefix: ["282", "281"],
    fieldMap: {
      address: "address",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "estimated_project_cost",
      description: "work_description",
      issued_date: "issued_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* ── Sources added from us_construction_data_sources.csv ──────────────── */

  /* 26 — LA Electrical Permits (2020+) */
  {
    id: "la_electrical",
    domain: "data.lacity.org",
    datasetId: "ysqd-apz7",
    city: "Los Angeles",
    state: "CA",
    zipPrefix: ["900", "901", "902"],
    fieldMap: {
      address: "address",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "work_description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 27 — LA Mechanical/HVAC Permits (2020+) */
  {
    id: "la_mechanical",
    domain: "data.lacity.org",
    datasetId: "67is-svtd",
    city: "Los Angeles",
    state: "CA",
    zipPrefix: ["900", "901", "902"],
    fieldMap: {
      address: "address",
      zip: "zip_code",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "work_description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 28 — NYC Electrical Permit Applications */
  {
    id: "nyc_electrical",
    domain: "data.cityofnewyork.us",
    datasetId: "dm9a-ab7w",
    city: "New York",
    state: "NY",
    zipPrefix: ["100", "101", "102", "103", "104", "110", "111", "112", "113", "114", "116"],
    fieldMap: {
      address: "job_location_house_number",
      zip: "zip_code",
      latitude: "gis_latitude",
      longitude: "gis_longitude",
      permit_type: "application_type",
      permit_number: "job_filing_number",
      permit_value: "estimated_job_costs",
      description: "job_description",
      issued_date: "approved_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 29 — NYC Street Construction Permits (2022-Present) */
  {
    id: "nyc_street_construction",
    domain: "data.cityofnewyork.us",
    datasetId: "tqtj-sjs8",
    city: "New York",
    state: "NY",
    zipPrefix: ["100", "101", "102", "103", "104", "110", "111", "112", "113", "114", "116"],
    fieldMap: {
      address: "on_street",
      zip: "zip_code",
      latitude: "gis_latitude",
      longitude: "gis_longitude",
      permit_type: "permit_type",
      permit_number: "permit_si_no",
      permit_value: "estimated_job_costs",
      description: "purpose_of_permit",
      issued_date: "permit_issuance_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 30 — Seattle Electrical Permits */
  {
    id: "seattle_electrical",
    domain: "cos-data.seattle.gov",
    datasetId: "c4tj-daue",
    city: "Seattle",
    state: "WA",
    zipPrefix: ["981"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permitclass",
      permit_number: "application_permit_number",
      permit_value: "estprojectcost",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 31 — Seattle Trade/Mechanical Permits */
  {
    id: "seattle_mechanical",
    domain: "cos-data.seattle.gov",
    datasetId: "c87v-5hwh",
    city: "Seattle",
    state: "WA",
    zipPrefix: ["981"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permitclass",
      permit_number: "application_permit_number",
      permit_value: "estprojectcost",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 32 — Baton Rouge LA */
  {
    id: "baton_rouge",
    domain: "data.brla.gov",
    datasetId: "7fq7-8j7r",
    city: "Baton Rouge",
    state: "LA",
    zipPrefix: ["708", "707"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "estimated_cost",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 33 — Montgomery County MD — Electrical */
  {
    id: "montgomery_county_electrical",
    domain: "data.montgomerycountymd.gov",
    datasetId: "qxie-8qnp",
    city: "Montgomery County",
    state: "MD",
    zipPrefix: ["208", "209", "207", "206"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "estimated_cost",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 34 — Montgomery County MD — Mechanical */
  {
    id: "montgomery_county_mechanical",
    domain: "data.montgomerycountymd.gov",
    datasetId: "ih88-a6aa",
    city: "Montgomery County",
    state: "MD",
    zipPrefix: ["208", "209", "207", "206"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "estimated_cost",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 35 — New Jersey statewide */
  {
    id: "new_jersey",
    domain: "data.nj.gov",
    datasetId: "w9se-dmra",
    city: "New Jersey",
    state: "NJ",
    zipPrefix: ["070", "071", "072", "073", "074", "075", "076", "077", "078", "079", "080", "081", "082", "083", "084", "085", "086", "087", "088", "089"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "construction_cost",
      description: "use_group",
      issued_date: "date_issued",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 36 — Sonoma County CA */
  {
    id: "sonoma_county",
    domain: "data.sonomacounty.ca.gov",
    datasetId: "88ms-k5e7",
    city: "Sonoma County",
    state: "CA",
    zipPrefix: ["954", "955", "949"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "valuation",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },

  /* 37 — Norfolk VA */
  {
    id: "norfolk",
    domain: "data.norfolk.gov",
    datasetId: "fahm-yuh4",
    city: "Norfolk",
    state: "VA",
    zipPrefix: ["235"],
    fieldMap: {
      address: "address",
      zip: "zip",
      latitude: "latitude",
      longitude: "longitude",
      permit_type: "permit_type",
      permit_number: "permit_number",
      permit_value: "estimated_cost",
      description: "description",
      issued_date: "issue_date",
    },
    tradeKeywords: COMMON_TRADE_KEYWORDS,
  },
];

/* ── Helper: detect trade from text fields ───────────────────────────────── */

export function detectTrade(
  text: string | null | undefined,
  keywords: TradeKeyword[],
): HenriTrade {
  if (!text) return "other";
  for (const { pattern, trade } of keywords) {
    if (pattern.test(text)) return trade;
  }
  return "other";
}
