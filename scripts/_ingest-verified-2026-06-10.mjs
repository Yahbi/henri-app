/**
 * Ingest the agent-verified live permit endpoints (2026-06-10 coverage sweep).
 * Socrata + ArcGIS only (the Vercel scrape cron handles those two reliably).
 * CSV/CKAN endpoints (San Antonio, San Diego, Met Council, Pittsburgh) are
 * deferred to the Hetzner loaders — noted at the bottom.
 *
 * All rows: enabled, field_mapping_status='verified', last_count=1 so they
 * enter the producer lane and scrape on the next hourly run. ArcGIS endpoints
 * are the layer base URL WITHOUT /query (the scraper appends it).
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const sql = async (q) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/ivfxylgoxgrxttknewsf/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: q }),
    },
  );
  const t = await r.text();
  return t.startsWith("<") ? { html: t.slice(0, 120) } : JSON.parse(t);
};

const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// type, state, key-slug, name, endpoint, {id,type,status,desc,addr,date,value,lat,lng}, layer_index
const ROWS = [
  // ── ArcGIS ──────────────────────────────────────────────────────────
  ["arcgis", "FL", "tampa-permitsall", "City of Tampa - PermitsAll (Daily)",
   "https://arcgis.tampagov.net/arcgis/rest/services/Planning/PermitsAll/MapServer/0",
   { id: "RECORD_ID", type: "RECORDTYPE", status: "PROJECTSTATUS", desc: "PROJECTDESCRIPTION", addr: "ADDRESS", date: "CREATEDDATE", value: null, lat: null, lng: null }, 0],
  ["arcgis", "DC", "dc-dcra-permits-2026", "Washington DC - Building Permits 2026 (DLCP)",
   "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18",
   { id: "PERMIT_ID", type: "PERMIT_TYPE_NAME", status: "APPLICATION_STATUS_NAME", desc: "DESC_OF_WORK", addr: "FULL_ADDRESS", date: "ISSUE_DATE", value: "FEES_PAID", lat: "LATITUDE", lng: "LONGITUDE" }, 18],
  ["arcgis", "FL", "miami-dade-county-permits", "Miami-Dade County - Permits (contractor phone)",
   "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0",
   { id: "PermitNumber", type: "PermitType", status: null, desc: "ProposedUseDescription", addr: "PropertyAddress", date: "PermitIssuedDate", value: "EstimatedValue", lat: null, lng: null }, 0],
  ["arcgis", "FL", "miami-city-permits-since-2014", "City of Miami - Building Permits Since 2014",
   "https://services1.arcgis.com/CvuPhqcTQpZPT9qY/arcgis/rest/services/Building_Permits_Since_2014/FeatureServer/0",
   { id: "PermitNumber", type: null, status: "BuildingPermitStatusDescription", desc: "ScopeofWork", addr: "DeliveryAddress", date: "IssuedDate", value: "TotalCost", lat: "Latitude", lng: "Longitude" }, 0],
  ["arcgis", "CO", "denver-residential-permits", "City of Denver - Residential Construction Permits",
   "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_RESIDENTIALCONSTPERMIT_P/FeatureServer/316",
   { id: "PERMIT_NUM", type: "CLASS", status: null, desc: null, addr: "ADDRESS", date: "DATE_ISSUED", value: "VALUATION", lat: null, lng: null }, 316],
  ["arcgis", "CO", "denver-commercial-permits", "City of Denver - Commercial Construction Permits",
   "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_COMMERCIALCONSTPERMIT_P/FeatureServer/317",
   { id: "PERMIT_NUM", type: "CLASS", status: null, desc: null, addr: "ADDRESS", date: "DATE_ISSUED", value: "VALUATION", lat: null, lng: null }, 317],
  ["arcgis", "NC", "mecklenburg-county-permits", "Mecklenburg County - Building Permits (Charlotte metro)",
   "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0",
   { id: "permitnum", type: "permittype", status: "permitstat", desc: "workdesc", addr: "projadd", date: "issuedate", value: "bldgcost", lat: null, lng: null }, 0],
  ["arcgis", "MD", "baltimore-permits-2019", "City of Baltimore - Housing & Building Permits 2019-Present",
   "https://egisdata.baltimorecity.gov/egis/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3",
   { id: "CaseNumber", type: null, status: null, desc: "Description", addr: "Address", date: "IssuedDate", value: "Cost", lat: null, lng: null }, 3],
  ["arcgis", "CA", "sacramento-permits-issued", "City of Sacramento - Building Permits Issued (Current Year)",
   "https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/BldgPermitIssued_CurrentYear/FeatureServer/0",
   { id: "Application", type: "Type", status: "Current_Status", desc: "Work_Desc", addr: "Address", date: "Status_Date", value: "Valuation", lat: null, lng: null }, 0],
  ["arcgis", "AZ", "maricopa-county-permits", "Maricopa County - Building Permits (unincorporated)",
   "https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Building_Permits_%28view%29/FeatureServer/0",
   { id: "PermitNumber", type: "PermitType", status: "PermitStatus", desc: "PermitDescription", addr: "FullStreetAddress", date: "IssuedDate", value: null, lat: null, lng: null }, 0],
  ["arcgis", "OR", "portland-residential-permits", "City of Portland - Residential Building Permits (BDS)",
   "https://www.portlandmaps.com/od/rest/services/COP_OpenData_PlanningDevelopment/MapServer/89",
   { id: "FOLDERNUMB", type: "NEWTYPE", status: "STATUS", desc: "WORKDESC", addr: "PROP_ADDRE", date: "ISSUEDATE", value: "VALUATION", lat: null, lng: null }, 89],
  ["arcgis", "ID", "compass-boise-metro-permits", "COMPASS - Boise Metro Regional Permits (Ada+Canyon)",
   "https://swidrdc.org/arcgis/rest/services/CompassMembers/Demographics_TAZForecast_Permits/FeatureServer/0",
   { id: "pnum", type: "type", status: null, desc: "work", addr: "address", date: null, value: "value", lat: null, lng: null }, 0],
  // ── Socrata ─────────────────────────────────────────────────────────
  ["socrata", "WA", "seattle-sdci-permits", "City of Seattle - SDCI Building Permits",
   "https://data.seattle.gov/resource/76t5-zqzr.json",
   { id: "permitnum", type: "permittypemapped", status: "statuscurrent", desc: "description", addr: "originaladdress1", date: "issueddate", value: "estprojectcost", lat: "latitude", lng: "longitude" }, 0],
  ["socrata", "FL", "orlando-permit-applications", "City of Orlando - Permit Applications (contractor phone)",
   "https://data.cityoforlando.net/resource/ryhf-m453.json",
   { id: "permit_number", type: "worktype", status: "application_status", desc: null, addr: "permit_address", date: "issue_permit_date", value: "estimated_cost", lat: null, lng: null }, 0],
  ["socrata", "OH", "cincinnati-permits", "City of Cincinnati - Building Permits",
   "https://data.cincinnati-oh.gov/resource/uhjb-xac9.json",
   { id: "permitnum", type: "permittypemapped", status: "statuscurrent", desc: null, addr: "originaladdress1", date: "applieddate", value: "estprojectcostdec", lat: null, lng: null }, 0],
  ["socrata", "HI", "honolulu-dpp-permits", "Honolulu DPP - Building Permits 2005-present",
   "https://data.honolulu.gov/resource/4vab-c87q.json",
   { id: "buildingpermitno", type: "proposeduse", status: "statusdescription", desc: "proposeduse", addr: null, date: "issuedate", value: "estimatedvalueofwork", lat: null, lng: null }, 0],
];

const values = ROWS.map(([type, state, slug, name, endpoint, f, layer]) => {
  const key = `${type}:${state}:${slug}`;
  return `(${lit(key)}, ${lit(name)}, ${lit(state)}, ${lit(endpoint)}, ${lit(type)}, ` +
    `${lit(f.id)}, ${lit(f.type)}, ${lit(f.status)}, ${lit(f.desc)}, ${lit(f.addr)}, ${lit(f.date)}, ${lit(f.value)}, ${lit(f.lat)}, ${lit(f.lng)}, ${layer}, ` +
    `true, 1, 0, 'verified', 'agent_verified_2026-06-10', 10)`;
}).join(",\n");

const q = `
INSERT INTO public.permit_sources
  (source_key, name, state, endpoint, source_type,
   id_field, type_field, status_field, desc_field, address_field, date_field, value_field, lat_field, lng_field, layer_index,
   enabled, last_count, error_count, field_mapping_status, discovered_via, priority)
VALUES
${values}
ON CONFLICT (source_key) DO UPDATE SET
  endpoint = EXCLUDED.endpoint,
  id_field = EXCLUDED.id_field, type_field = EXCLUDED.type_field, status_field = EXCLUDED.status_field,
  desc_field = EXCLUDED.desc_field, address_field = EXCLUDED.address_field, date_field = EXCLUDED.date_field,
  value_field = EXCLUDED.value_field, lat_field = EXCLUDED.lat_field, lng_field = EXCLUDED.lng_field,
  layer_index = EXCLUDED.layer_index, enabled = true, error_count = 0,
  field_mapping_status = 'verified', discovered_via = EXCLUDED.discovered_via, priority = 10,
  updated_at = now()
RETURNING source_key;
`;

const res = await sql(q);
console.log("upserted:", JSON.stringify(res).slice(0, 1500));
console.log("count:", Array.isArray(res) ? res.length : "see above");
