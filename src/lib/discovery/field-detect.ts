/**
 * Deterministic permit-field auto-detection.
 *
 * Given the column names of an open-data permit dataset (Socrata or
 * ArcGIS), pick the best column for each role the scrapers need. Pure
 * function, no I/O — drives the self-perpetuating discovery loop
 * (`/api/cron/discover-sources`) so new municipal datasets get mapped
 * and ingested without a human or an LLM in the loop.
 *
 * Matching is case-insensitive and order-sensitive: the candidate lists
 * are ordered best-first, so "issue_date" beats "applied_date" and a
 * real permit number beats the ArcGIS objectid fallback.
 */

export interface DetectedFields {
  idField: string | null;
  typeField: string | null;
  statusField: string | null;
  descField: string | null;
  addressField: string | null;
  dateField: string | null;
  valueField: string | null;
  latField: string | null;
  lngField: string | null;
}

export interface DetectResult extends DetectedFields {
  /** True when the mapping is good enough to enable the source: a usable
   *  id + a usable date. Address is best-effort (some permit datasets are
   *  parcel-keyed) — its absence does not block collection, only leads. */
  enable: boolean;
  /** A real permit identifier was found (not the objectid row-id fallback). */
  hasRealId: boolean;
  /** Looks like a building-permit dataset (name or columns mention it). */
  looksLikePermits: boolean;
}

// Ordered best-first. All entries lowercase.
const ID = [
  "permit_number", "permit_nbr", "permitnumber", "permitnum", "permit_num",
  "permit_no", "permitno", "permit_id", "permitid", "permit_", "permit", "record_id",
  "recordid", "record_num", "casenumber", "case_number", "case_no",
  "application_number", "applicationnumber", "application_no", "application",
  "foldernumber", "foldernumb", "folder_number", "pnum", "buildingpermitno",
  "bldg_permit_no", "permitnum_full",
];
const ID_FALLBACK = ["objectid", "object_id", "fid", "globalid", "gid"];

const DATE = [
  "issue_date", "issued_date", "issueddate", "issuedate", "date_issued",
  "dateissued", "issue_permit_date", "permitissueddate", "permit_issued_date",
  "permit_issue_date", "issuance_date", "status_date", "applieddate",
  "applied_date", "application_date", "applicationdate", "app_date",
  "createddate", "created_date", "create_date", "addeddate", "added_date",
  "in_date", "indate", "filing_date", "filed_date", "submit_date",
];

const TYPE = [
  "permit_type", "permittype", "permit_type_name", "permittypemapped",
  "permit_type_desc", "permit_class", "permitclass", "permitclassmapped",
  "recordtype", "record_type", "work_type", "worktype", "worktypemapped",
  "application_type", "applicationtype", "proposed_use", "proposeduse",
  "permit_category", "category", "newtype", "type", "class", "subtype",
];

const STATUS = [
  "permit_status", "permitstatus", "statuscurrent", "status_current",
  "current_status", "application_status", "application_status_name",
  "applicationstatusname", "projectstatus", "project_status", "status_desc",
  "statusdescription", "status_description", "buildingpermitstatusdescription",
  "permitstat", "permit_state", "status",
];

const ADDRESS = [
  "full_address", "fulladdress", "full_street_address", "fullstreetaddress",
  "original_address1", "originaladdress1", "originaladdress", "street_address",
  "streetaddress", "project_address", "projectaddress", "permit_address",
  "primary_address", "primaryaddress", "site_address", "siteaddress",
  "property_address", "propertyaddress", "job_address", "jobaddress",
  "work_address", "location_address", "gis_address", "deliveryaddress",
  "prop_addre", "projadd", "site_addr", "address1", "address", "addr",
];

const DESC = [
  "work_description", "workdescription", "workdesc", "desc_of_work",
  "description_of_work", "scope_of_work", "scopeofwork", "permit_description",
  "permitdescription", "projectdescription", "project_description",
  "detaildescriptioncomments", "proposed_use", "proposeduse", "work",
  "description", "descript", "comments", "remarks",
];

const VALUE = [
  "estimated_value", "estimatedvalue", "estimated_cost", "estimatedcost",
  "estimatedvalueofwork", "est_value", "est_cost", "estprojectcost",
  "estprojectcostdec", "declared_valuation", "declaredvaluation", "valuation",
  "total_project_value", "totalprojectvalue", "construction_value",
  "job_value", "jobvalue", "total_cost", "totalcost", "project_cost",
  "projectcost", "bldgcost", "constructioncost", "value", "cost",
];

const LAT = ["latitude", "lat", "y_coord", "ycoord", "point_y", "y"];
const LNG = ["longitude", "lng", "lon", "long", "x_coord", "xcoord", "point_x", "x"];
const COMBINED_LOC = [
  "location", "geocoded_column", "the_geom", "georeference", "point",
  "location_1", "geolocation", "geom", "lat_lon", "latlong", "latitude_longitude",
];

const PERMIT_TOKENS = ["permit", "construction", "building", "inspection"];

function pick(cols: Map<string, string>, candidates: string[]): string | null {
  for (const c of candidates) {
    const hit = cols.get(c);
    if (hit) return hit;
  }
  return null;
}

/**
 * @param columnNames raw column names from the dataset
 * @param sourceType  "socrata" | "arcgis" — ArcGIS gets lat/lng from
 *                     geometry, so we don't map point columns there.
 * @param datasetName optional dataset title, used for the permit sanity gate.
 */
export function detectFields(
  columnNames: string[],
  sourceType: "socrata" | "arcgis" | "ckan" = "socrata",
  datasetName = "",
): DetectResult {
  const cols = new Map<string, string>();
  for (const raw of columnNames) {
    if (typeof raw === "string" && raw.length > 0) {
      cols.set(raw.toLowerCase(), raw);
    }
  }

  let idField = pick(cols, ID);
  const hasRealId = idField !== null;
  if (!idField) idField = pick(cols, ID_FALLBACK);

  const dateField = pick(cols, DATE);
  const addressField = pick(cols, ADDRESS);

  let latField: string | null = null;
  let lngField: string | null = null;
  if (sourceType !== "arcgis") {
    latField = pick(cols, LAT);
    lngField = pick(cols, LNG);
    if (!latField || !lngField) {
      const combined = pick(cols, COMBINED_LOC);
      if (combined) {
        latField = combined;
        lngField = combined;
      }
    }
  }

  const haystack = (datasetName + " " + columnNames.join(" ")).toLowerCase();
  const looksLikePermits = PERMIT_TOKENS.some((t) => haystack.includes(t));

  // Enable when we can identify and time-stamp records. A real permit id
  // (not just objectid) OR a permit-looking name guards against false
  // positives from the catalog search.
  const enable =
    idField !== null &&
    dateField !== null &&
    looksLikePermits &&
    (hasRealId || /permit/.test(haystack));

  return {
    idField,
    typeField: pick(cols, TYPE),
    statusField: pick(cols, STATUS),
    descField: pick(cols, DESC),
    addressField,
    dateField,
    valueField: pick(cols, VALUE),
    latField,
    lngField,
    enable,
    hasRealId,
    looksLikePermits,
  };
}
