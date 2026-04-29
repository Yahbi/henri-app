#!/usr/bin/env npx tsx
/* Targeted probe of curated high-value v3 endpoints for nationwide expansion.
 * Only endpoints with known-good patterns from public open-data portals. */

const TARGETS: { key: string; type: "socrata" | "arcgis"; url: string }[] = [
  // — NYC DOB permits (Socrata) — CONFIRMED WORKING
  { key: "v3_nyc_dob",           type: "socrata", url: "https://data.cityofnewyork.us/resource/ipu4-2q9a.json" },
  // — NYC job applications — different endpoint
  { key: "v3_nyc_dob_jobs",      type: "socrata", url: "https://data.cityofnewyork.us/resource/ic3t-wcy2.json" },
  // — Dallas TX — on their socrata portal
  { key: "v3_dallas",            type: "socrata", url: "https://www.dallasopendata.com/resource/e7gq-4sah.json" },
  // — Fort Worth TX
  { key: "v3_fort_worth",        type: "arcgis",  url: "https://mapservices.fortworthtexas.gov/arcgis/rest/services/Development/BuildingInspection/MapServer/2" },
  // — Phoenix AZ — correct dataset
  { key: "v3_phoenix_new",       type: "socrata", url: "https://www.phoenixopendata.com/api/views/eyvx-yuqr/rows.json" },
  // — Salt Lake City UT
  { key: "v3_slc",               type: "arcgis",  url: "https://maps.slcgov.com/arcgis/rest/services/SLCPublicSafety/BuildingPermits/FeatureServer/0" },
  // — Plano TX
  { key: "v3_plano",             type: "arcgis",  url: "https://gis.plano.gov/arcgis/rest/services/Permits/Permits_Public/MapServer/0" },
  // — Orlando FL
  { key: "v3_orlando",           type: "arcgis",  url: "https://services1.arcgis.com/yeIB29lvAxkoQG0O/arcgis/rest/services/Building_Permits/FeatureServer/0" },
  // — Boulder CO
  { key: "v3_boulder",           type: "socrata", url: "https://bouldercolorado.gov/api/records/1.0/search/?dataset=building-permits" },
  // — Rochester NY
  { key: "v3_rochester",         type: "socrata", url: "https://data.cityofrochester.gov/resource/w7rz-xejv.json" },
  // — Durham NC (alt)
  { key: "v3_durham",            type: "socrata", url: "https://live-durhamnc.opendata.arcgis.com/api/v2/datasets/" },
  // — Raleigh NC downtown permits (alt)
  { key: "v3_raleigh_socrata",   type: "socrata", url: "https://data.raleighnc.gov/resource/uiux-gyr7.json" },
  // — Savannah GA
  { key: "v3_savannah",          type: "socrata", url: "https://data.savannahga.gov/resource/7cs4-kyfm.json" },
  // — Naperville IL
  { key: "v3_naperville",        type: "socrata", url: "https://data.napervilleil.gov/resource/q92u-uv7j.json" },
  // — Oakland — different dataset path
  { key: "v3_oakland_alt",       type: "arcgis",  url: "https://services1.arcgis.com/RBmce6zCAS1tJeP5/arcgis/rest/services/BuildingPermit/FeatureServer/0" },
  // — Mesa AZ
  { key: "v3_mesa",              type: "socrata", url: "https://data.mesaaz.gov/resource/bs2u-tnbs.json" },
  // — Boise ID
  { key: "v3_boise",             type: "arcgis",  url: "https://maps.cityofboise.org/server/rest/services/Development/DevelopmentApplications/MapServer/0" },
  // — Chesapeake VA
  { key: "v3_chesapeake",        type: "arcgis",  url: "https://gisweb.cityofchesapeake.net/arcgis/rest/services/OpenData/Permits/MapServer/0" },
  // — Henrico County VA
  { key: "v3_henrico",           type: "arcgis",  url: "https://gis.henrico.us/arcgis/rest/services/Permits/PermitsView/MapServer/0" },
  // — San Antonio TX
  { key: "v3_san_antonio",       type: "arcgis",  url: "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/Building_Permits/FeatureServer/0" },
  // — Bellevue WA
  { key: "v3_bellevue",          type: "arcgis",  url: "https://services.arcgis.com/SWWwdOUQY6pfbgqK/arcgis/rest/services/Permits/FeatureServer/0" },
  // — Tacoma WA
  { key: "v3_tacoma",            type: "arcgis",  url: "https://gis.cityoftacoma.org/arcgis/rest/services/Public/Permits/MapServer/0" },
  // — Spokane WA
  { key: "v3_spokane",           type: "socrata", url: "https://opendata.spokanecity.org/api/records/1.0/search/?dataset=building-permit-data&rows=1" },
  // — Columbia SC
  { key: "v3_columbia_sc",       type: "arcgis",  url: "https://services9.arcgis.com/PjCDyiV4wT5aXyCN/arcgis/rest/services/BuildingPermits/FeatureServer/0" },
  // — Grand Rapids MI
  { key: "v3_grand_rapids",      type: "arcgis",  url: "https://services1.arcgis.com/kEkusxYWJRgpF5f2/arcgis/rest/services/Permits/FeatureServer/0" },
  // — Lexington KY
  { key: "v3_lexington",         type: "arcgis",  url: "https://maps.lexingtonky.gov/lfucggis/rest/services/Permits/permitsview/MapServer/0" },
  // — Tulsa OK
  { key: "v3_tulsa",             type: "socrata", url: "https://www.cityoftulsa.org/api/data/permits/" }, // dry
  // — OKC
  { key: "v3_okc",               type: "arcgis",  url: "https://services.arcgis.com/PUROw2yoM1xiEy24/arcgis/rest/services/PermitsIssued/FeatureServer/0" },
  // — Charleston SC official
  { key: "v3_charleston",        type: "arcgis",  url: "https://gisdev.charleston-sc.gov/arcgis/rest/services/Permits/Permits/MapServer/0" },
  // — El Paso TX
  { key: "v3_elpaso",            type: "arcgis",  url: "https://gispub.elpasotexas.gov/arcgis/rest/services/Permits/BuildingPermits/MapServer/0" },
  // — Colorado Springs CO
  { key: "v3_colorado_springs",  type: "arcgis",  url: "https://services1.arcgis.com/l0ZVnFKJmQIMFH1y/arcgis/rest/services/BuildingPermits/FeatureServer/0" },
  // — Portland OR
  { key: "v3_portland",          type: "arcgis",  url: "https://www.portlandmaps.com/arcgis/rest/services/Public/COP_Permits/MapServer/0" },
  // — Minneapolis MN
  { key: "v3_minneapolis",       type: "socrata", url: "https://opendata.minneapolismn.gov/api/v2/catalog/datasets/building-permits/exports/json" },
  // — St. Paul MN
  { key: "v3_stpaul",            type: "arcgis",  url: "https://gis.stpaul.gov/arcgis/rest/services/Permits/BuildingPermits/MapServer/0" },
  // — Providence RI
  { key: "v3_providence",        type: "arcgis",  url: "https://data.providenceri.gov/arcgis/rest/services/Data/Building_Permits/MapServer/0" },
  // — Albuquerque NM
  { key: "v3_albuquerque",       type: "arcgis",  url: "https://services.arcgis.com/lZCvdlBZmJ3fUJBb/arcgis/rest/services/BuildingPermits/FeatureServer/0" },
  // — Bakersfield CA
  { key: "v3_bakersfield",       type: "arcgis",  url: "https://services1.arcgis.com/1IXyl2rCdyqPhmBn/arcgis/rest/services/PermitsBuilding/FeatureServer/0" },
];

async function probe(t: typeof TARGETS[number]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const url =
      t.type === "arcgis"
        ? `${t.url}/query?where=1%3D1&outFields=*&f=json&resultRecordCount=1&returnGeometry=true`
        : `${t.url}${t.url.includes("?") ? "&" : "?"}$limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Henri/1.0 schema-probe" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { key: t.key, ok: false, note: `HTTP ${res.status}`, fields: [] as string[], sample: null as Record<string, unknown> | null };
    const body = await res.text();
    let json: unknown;
    try { json = JSON.parse(body); }
    catch { return { key: t.key, ok: false, note: "non-JSON", fields: [], sample: null }; }
    if (typeof json === "object" && json !== null && "error" in json) {
      const e = (json as { error: { message?: string } }).error;
      return { key: t.key, ok: false, note: `api-err: ${e?.message ?? "?"}`, fields: [], sample: null };
    }
    if (t.type === "arcgis") {
      const j = json as { features?: { attributes?: Record<string, unknown>; geometry?: unknown }[] };
      const f = j.features?.[0];
      if (!f?.attributes) return { key: t.key, ok: false, note: "no features", fields: [], sample: null };
      return {
        key: t.key,
        ok: true,
        note: `${j.features?.length ?? 0} rows`,
        fields: Object.keys(f.attributes),
        sample: f.attributes,
      };
    } else {
      const arr = json as Record<string, unknown>[];
      if (!arr[0]) return { key: t.key, ok: false, note: "no rows", fields: [], sample: null };
      return {
        key: t.key,
        ok: true,
        note: `${arr.length} rows`,
        fields: Object.keys(arr[0]),
        sample: arr[0],
      };
    }
  } catch (e) {
    clearTimeout(timeout);
    return { key: t.key, ok: false, note: `fetch: ${e instanceof Error ? e.message : String(e)}`, fields: [], sample: null };
  }
}

async function main() {
  const results = await Promise.all(TARGETS.map(probe));
  console.log("=".repeat(96));
  console.log(`  v3 candidate probes — ${TARGETS.length} endpoints`);
  console.log("=".repeat(96));
  for (const r of results) {
    const mark = r.ok ? "OK  " : "FAIL";
    console.log(`\n  ${mark} ${r.key.padEnd(28)} ${r.note}`);
    if (r.ok) {
      console.log(`       fields: ${r.fields.slice(0, 20).join(", ")}`);
      if (r.sample) {
        const keyFields = ["permit_number", "permitnumber", "permit_id", "permitnum", "permit_", "permit_num", "number", "id", "PERMIT_NUMBER", "PERMITNUMBER"];
        const addrFields = ["address", "site_address", "originaladdress1", "street_address", "property_address", "ADDRESS"];
        const dateFields = ["issue_date", "issued_date", "issueddate", "ISSUE_DATE", "issuance_date"];
        const hit = (keys: string[]) => keys.find(k => r.fields.includes(k));
        console.log(`       id=${hit(keyFields)} addr=${hit(addrFields)} date=${hit(dateFields)}`);
      }
    }
  }
  console.log("\n" + "=".repeat(96));
  console.log(`  ${results.filter(r => r.ok).length}/${results.length} ok`);
}

main();
