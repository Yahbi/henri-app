export interface PermitSource {
  /**
   * Registry key of the feed, when this source came from `permit_sources`.
   *
   * Optional because the hardcoded PERMIT_SOURCES fallback below has no
   * registry row. Written to `permits.source_key` for PROVENANCE only — it is
   * deliberately not part of the upsert conflict target, since 46% of enabled
   * sources have a blank `city` and therefore all share the single namespace
   * (source_city='', source_id='_<rawId>'). Changing the key would re-insert
   * ~952k existing permits as duplicates. See migration 00133.
   */
  source_key?: string;
  city: string;
  state: string;
  endpoint: string;
  idField: string;
  typeField: string;
  statusField: string;
  descField: string;
  addressField: string;
  dateField: string;
  valueField: string;
  latField: string;
  lngField: string;
}

export const PERMIT_SOURCES: PermitSource[] = [
  {
    city: "Chicago",
    state: "IL",
    endpoint: "https://data.cityofchicago.org/resource/ydr8-5enu.json",
    idField: "id",
    typeField: "permit_type",
    statusField: "permit_status",
    descField: "work_description",
    addressField: "street_address",
    dateField: "issue_date",
    valueField: "reported_cost",
    latField: "latitude",
    lngField: "longitude",
  },
  {
    city: "New York",
    state: "NY",
    endpoint: "https://data.cityofnewyork.us/resource/ipu4-2vj7.json",
    idField: "job__",
    typeField: "job_type",
    statusField: "job_status",
    descField: "job_description",
    addressField: "house__street_name",
    dateField: "filing_date",
    valueField: "initial_cost",
    latField: "latitude",
    lngField: "longitude",
  },
  {
    city: "Los Angeles",
    state: "CA",
    endpoint: "https://data.lacity.org/resource/nbyu-2ha9.json",
    idField: "pcis_permit",
    typeField: "permit_type",
    statusField: "status",
    descField: "work_description",
    addressField: "address",
    dateField: "issue_date",
    valueField: "valuation",
    latField: "latitude",
    lngField: "longitude",
  },
  {
    city: "Houston",
    state: "TX",
    endpoint: "https://data.houstontx.gov/resource/4wij-ktsw.json",
    idField: "match_id",
    typeField: "permit_type",
    statusField: "status_current",
    descField: "project_description",
    addressField: "street_address",
    dateField: "applied_date",
    valueField: "estimated_value",
    latField: "latitude",
    lngField: "longitude",
  },
  {
    city: "Phoenix",
    state: "AZ",
    endpoint: "https://data.phoenix.gov/resource/m5q3-fxjn.json",
    idField: "permit_number",
    typeField: "type",
    statusField: "status",
    descField: "description",
    addressField: "address",
    dateField: "applied_date",
    valueField: "valuation",
    latField: "latitude",
    lngField: "longitude",
  },
  {
    city: "Denver",
    state: "CO",
    endpoint: "https://data.denvergov.org/resource/c5tk-bn43.json",
    idField: "permit_number",
    typeField: "permit_type_name",
    statusField: "status",
    descField: "work_description",
    addressField: "full_address",
    dateField: "issue_date",
    valueField: "value",
    latField: "latitude",
    lngField: "longitude",
  },
];
