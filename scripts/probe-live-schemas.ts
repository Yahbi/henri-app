#!/usr/bin/env npx tsx
/* Probe each target endpoint and dump the first row's full schema so we can
 * correct field mappings. Given a list of endpoints we suspect are viable,
 * this prints the response shape and hints at the right field names.
 */

const TARGETS: { key: string; type: "socrata" | "arcgis"; url: string }[] = [
  // Known reachable but fields mismatched
  { key: "socrata_austin",       type: "socrata", url: "https://data.austintexas.gov/resource/3syk-w9eu.json" },
  { key: "socrata_chicago",      type: "socrata", url: "https://data.cityofchicago.org/resource/ydr8-5enu.json" },
  { key: "socrata_cincinnati",   type: "socrata", url: "https://data.cincinnati-oh.gov/resource/uhjb-xac9.json" },
  { key: "socrata_seattle",      type: "socrata", url: "https://data.seattle.gov/resource/76t5-zqzr.json" },
  { key: "socrata_sf",           type: "socrata", url: "https://data.sfgov.org/resource/i98e-djp9.json" },
  { key: "v2_baton_rouge",       type: "socrata", url: "https://data.brla.gov/resource/7fq7-8j7r.json" },
  // Candidates for nationwide expansion (newly verified)
  { key: "v3_nyc_dob",           type: "socrata", url: "https://data.cityofnewyork.us/resource/ipu4-2q9a.json" },
  { key: "v3_philly",            type: "socrata", url: "https://phl.carto.com/api/v2/sql?q=SELECT * FROM permits LIMIT 1&format=json" },
  { key: "v3_columbus",          type: "arcgis",  url: "https://maps2.columbus.gov/arcgis/rest/services/Schemas/Permits_Operational/MapServer/2" },
  { key: "v3_mecklenburg_nc",    type: "arcgis",  url: "https://meckgis.mecklenburgcountync.gov/server/rest/services/OpenMapping/Permitting/MapServer/0" },
  { key: "v3_san_diego",         type: "socrata", url: "https://data.sandiego.gov/datasets/bldg-permits/" }, // placeholder
  { key: "v3_kcmo",              type: "socrata", url: "https://data.kcmo.org/resource/6qux-tt7f.json" },
  { key: "v3_oakland",           type: "socrata", url: "https://data.oaklandca.gov/resource/ernv-wveh.json" },
  { key: "v3_chattanooga",       type: "socrata", url: "https://www.chattadata.org/resource/8btb-ynuh.json" },
  { key: "v3_pittsburgh",        type: "socrata", url: "https://data.wprdc.org/dataset/pli-permits/resource/44fe7d04-7e82-457f-8fce-17e09f938f80" },
  { key: "v3_mesa_az",           type: "arcgis",  url: "https://services.arcgis.com/LYDNFo7xa6SuzCW7/arcgis/rest/services/Permits_Web/FeatureServer/0" },
  { key: "v3_gwinnett_ga",       type: "arcgis",  url: "https://services7.arcgis.com/qvTBjbOZFxBdmrR9/arcgis/rest/services/Building_Permits_Public/FeatureServer/0" },
  { key: "v3_charleston_sc",     type: "arcgis",  url: "https://services.arcgis.com/DkbRJj19HaBIuhjR/arcgis/rest/services/Permits_Permit_Applications_Public_View/FeatureServer/0" },
  { key: "v3_virginia_beach",    type: "arcgis",  url: "https://gis.vbgov.com/arcgis/rest/services/OpenData/OpenData_PandI/MapServer/1" },
  { key: "v3_omaha",             type: "arcgis",  url: "https://gis.cityofomaha.org/arcgis/rest/services/PlanningPermits/MapServer/2" },
  { key: "v3_indianapolis",      type: "socrata", url: "https://data.indy.gov/resource/iswc-txxa.json" },
  { key: "v3_richmond_va",       type: "socrata", url: "https://data.richmondgov.com/resource/gxq4-s6ts.json" },
  { key: "v3_kansas_city_mo",    type: "socrata", url: "https://data.kcmo.org/resource/cbf2-y3t4.json" },
  { key: "v3_boston",            type: "arcgis",  url: "https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Boston_Licenses_and_Permits/FeatureServer/0" },
];

async function probe(t: typeof TARGETS[number]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
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
    const out: string[] = [];
    out.push(`\n── ${t.key} (${t.type}) ──────────────────────────────`);
    out.push(`URL:    ${t.url}`);
    out.push(`STATUS: ${res.status} ${res.statusText}`);
    if (!res.ok) { out.push("(skipping body)"); return out.join("\n"); }
    const body = await res.text();
    let json: unknown;
    try { json = JSON.parse(body); }
    catch { out.push(`NON-JSON (first 200): ${body.slice(0, 200)}`); return out.join("\n"); }
    if (typeof json === "object" && json !== null && "error" in json) {
      out.push(`API ERROR: ${JSON.stringify((json as { error: unknown }).error).slice(0, 200)}`);
      return out.join("\n");
    }
    if (t.type === "arcgis") {
      const j = json as { features?: { attributes?: Record<string, unknown>; geometry?: unknown }[] };
      const f = j.features?.[0];
      out.push(`FIELDS: ${f?.attributes ? Object.keys(f.attributes).join(", ") : "(none)"}`);
      if (f?.attributes) {
        const sample = Object.entries(f.attributes).slice(0, 12)
          .map(([k, v]) => `  ${k} = ${typeof v === "string" ? v.slice(0, 60) : JSON.stringify(v)}`).join("\n");
        out.push(`SAMPLE VALUES:\n${sample}`);
      }
      if (f?.geometry) out.push(`GEOMETRY: ${JSON.stringify(f.geometry).slice(0, 120)}`);
    } else {
      const arr = json as Record<string, unknown>[];
      if (!arr[0]) { out.push("NO ROWS"); return out.join("\n"); }
      out.push(`FIELDS: ${Object.keys(arr[0]).join(", ")}`);
      const sample = Object.entries(arr[0]).slice(0, 12)
        .map(([k, v]) => `  ${k} = ${typeof v === "string" ? v.slice(0, 60) : JSON.stringify(v)}`).join("\n");
      out.push(`SAMPLE VALUES:\n${sample}`);
    }
    return out.join("\n");
  } catch (e) {
    clearTimeout(timeout);
    return `\n── ${t.key} — FETCH ERROR: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function main() {
  const reports = await Promise.all(TARGETS.map(probe));
  for (const r of reports) console.log(r);
}

main();
