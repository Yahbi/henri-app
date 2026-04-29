/**
 * Shared probe logic for permit-source endpoints. Called by both the
 * admin API route (`/api/admin/sources/probe`) and the bulk-probe
 * script (`scripts/bulk-probe-major-metros.ts`) so the field-detection
 * heuristics stay in one place.
 *
 * Returns null on unreachable / timed-out / unknown-platform endpoints.
 */

export interface ProbeResult {
  ok: boolean;
  reachable: boolean;
  row_count: number | null;
  fields: {
    id_field?: string;
    type_field?: string;
    status_field?: string;
    desc_field?: string;
    address_field?: string;
    date_field?: string;
    value_field?: string;
    lat_field?: string;
    lng_field?: string;
  };
  sample_row?: Record<string, unknown>;
  error?: string;
}

/**
 * Topical gate — require evidence the dataset is actually about
 * permits before we enable it. Field-shape alone is not enough:
 * water-boundary polygons, NWS watches, park-and-ride locations, and
 * air-quality districts all ship `objectid` + an `address`-like
 * column and were passing the probe at smoke-test time.
 *
 * Signal looked for: a permit-flavoured keyword in the endpoint URL,
 * the dataset name (ArcGIS service label), or one of the column names
 * themselves. Broad enough to let genuine permit / code / inspection /
 * development datasets through, narrow enough to reject the obvious
 * non-permit false positives.
 */
const PERMIT_KEYWORDS = [
  "permit", "license", "licens",
  "build", "bldg", "construct",
  // Space-separated forms appear in catalog names ("Code Enforcement All Cases")
  // — the underscore variants alone missed them.
  "code_enf", "codeenforce", "code-enforce", "code enforce", "enforcement",
  "inspection", "violation",
  "develop", "land_use", "landuse", "land use",
  "zoning", "rezone",
  "demolition", "demo_", "teardown",
  "dob", "dept_of_build", "dept-of-build", "dept of build",
  "plan_review", "plancheck", "plan_check", "plan review",
  "application", "case_", "case management", "record",
  // Trade-specific keywords that flag permit-adjacent datasets.
  "roofing", "roof ",
  "electrical permit", "plumbing permit", "mechanical permit",
  "hvac permit",
];

function looksLikePermitTopic(
  endpoint: string,
  fields: string[],
  datasetName?: string,
): boolean {
  const haystack = [
    endpoint,
    datasetName ?? "",
    ...fields,
  ].join(" ").toLowerCase();
  return PERMIT_KEYWORDS.some((kw) => haystack.includes(kw));
}

/** Build an index of field names normalized to lowercase for matching. */
function fieldIndex(fields: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fields) m.set(f.toLowerCase(), f);
  return m;
}

/** First matching field name from a priority list of lowercase candidates. */
function pick(idx: Map<string, string>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    for (const [low, orig] of idx) {
      if (low === c || low.includes(c)) return orig;
    }
  }
  return undefined;
}

/**
 * Heuristic mapping from canonical field roles to common upstream names.
 * Candidate lists were widened in Phase 5a after a 1k-row sweep
 * produced 89% "reachable but no mapping" — most of those were real
 * permit datasets whose fields used names we hadn't catalogued.
 *
 * Optional `aliases` arg: ArcGIS field objects ship both a `name`
 * (e.g. `PER_TYP_CD`) and a human-readable `alias` (`"Permit Type"`).
 * When we have the alias we include it in the match pool so cryptically-
 * named columns still resolve. See 5a.3.
 */
function inferMapping(
  fields: string[],
  aliases?: Record<string, string>,
): ProbeResult["fields"] {
  // Fold aliases into the index so a column can be matched by either
  // its name OR its alias — whichever resembles the canonical role.
  const expanded: string[] = [...fields];
  if (aliases) {
    for (const [name, alias] of Object.entries(aliases)) {
      if (alias && alias !== name) expanded.push(alias);
    }
  }
  const idx = fieldIndex(expanded);
  const matched = {
    id_field: pick(idx, [
      "permit_num", "permit_number", "permitnum", "permit_no", "permit_id",
      "case_number", "case_num", "application_number", "record_number",
      "record_id", "primary_key", "objectid", "globalid", "permit",
      "id",
    ]),
    type_field: pick(idx, [
      "permit_type", "permit type", "work_type", "work type",
      "permittype", "permit_subtype", "work_class", "application_type",
      "record_type", "subtype", "classification", "type",
    ]),
    status_field: pick(idx, [
      "permit_status", "applicationstatus", "record_status", "current_status",
      "status",
    ]),
    desc_field: pick(idx, [
      "work_description", "project_description", "description",
      "scope_of_work", "scope", "project_name", "job_description",
    ]),
    address_field: pick(idx, [
      "site_address", "situs_address", "property_address", "project_address",
      "location_address", "full_address", "property_location", "address1",
      "streetaddress", "street_address", "bldg_addr", "site_addr",
      "location1", "location_1", "site", "address",
    ]),
    date_field: pick(idx, [
      "issue_date", "issued_date", "issuedate", "issue_dat", "permit_date",
      "applied_date", "application_date", "applied", "filing_date",
      // "stat_date" / "statdate" shows up on NOLA's code-enforcement
      // datasets; "opendate" / "date_opened" on KCMO demolition.
      "open_date", "opened", "date_opened", "opendate",
      "close_date", "closedate", "closed_date",
      "statusdate", "status_date", "stat_date", "statdate",
      "created_dt", "created_at", "created", "appld_date",
    ]),
    value_field: pick(idx, [
      "estimated_cost", "estimated_value", "job_value", "permit_value",
      "total_value", "declared_value", "est_value", "construction_cost",
      "valuation", "value", "totsqft", "cost",
    ]),
    lat_field: pick(idx, ["latitude", "lat", "y_coord", "y"]),
    lng_field: pick(idx, ["longitude", "lng", "lon", "long", "x_coord", "x"]),
  };
  // If matched values came from aliases, translate back to the real
  // field name so callers can use them in queries. Reverse-lookup in the
  // alias map — find the `name` whose alias equals the value we picked.
  if (aliases) {
    const aliasToName = new Map<string, string>();
    for (const [name, alias] of Object.entries(aliases)) {
      if (alias) aliasToName.set(alias, name);
    }
    for (const k of Object.keys(matched) as Array<keyof typeof matched>) {
      const v = matched[k];
      if (v && aliasToName.has(v)) matched[k] = aliasToName.get(v)!;
    }
  }
  return matched;
}

/**
 * Detect an ArcGIS Hub / AGOL *landing* URL — these are HTML portal
 * pages, not REST endpoints. Shape: `https://X.maps.arcgis.com` or
 * `https://X.arcgis.com` with no `/rest/services/` path segment. The
 * `?f=json` probe returns HTML against these, which manifested as a
 * 99.7% failure rate during the first bulk-probe sweep (997 of 1000
 * ArcGIS failures). Flag them permanently so the scanner moves on.
 *
 * A future enhancement could query the Hub search API to *discover*
 * FeatureServers under each org, but that's a different ingester,
 * not a probe. For now, fail loudly and skip.
 */
function isArcGISHubLanding(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    const looksLikeArcgisHost =
      host.endsWith(".arcgis.com") ||
      host.endsWith(".maps.arcgis.com") ||
      host === "opendata.arcgis.com" ||
      host === "hub.arcgis.com";
    // A real FeatureServer/MapServer path always contains this segment.
    const hasRestPath = /\/rest\/services\//i.test(path);
    return looksLikeArcgisHost && !hasRestPath;
  } catch {
    return false;
  }
}

async function probeArcGIS(endpoint: string): Promise<ProbeResult> {
  // Short-circuit: landing URLs with no REST path can't be probed.
  if (isArcGISHubLanding(endpoint)) {
    return {
      ok: false,
      reachable: false,
      row_count: null,
      fields: {},
      error: "platform-unprobeable: arcgis-hub-landing (not a FeatureServer)",
    };
  }

  // ArcGIS layer URL → schema via ?f=json, row count via /query?where=1=1&returnCountOnly=true
  const base = endpoint.replace(/\/query\/?$/, "");
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const [schemaRes, countRes] = await Promise.all([
      fetch(`${base}?f=json`, { signal: ctrl.signal }),
      fetch(`${base}/query?where=1%3D1&returnCountOnly=true&f=json`, { signal: ctrl.signal }),
    ]);
    clearTimeout(timeout);

    if (!schemaRes.ok) return { ok: false, reachable: false, row_count: null, fields: {}, error: `schema ${schemaRes.status}` };

    // Some hosts return 200 with an HTML error / landing page when the
    // given URL isn't a valid service. Detect and mark unprobeable so
    // it doesn't churn the retry budget.
    const ctHeader = schemaRes.headers.get("content-type") ?? "";
    if (ctHeader.includes("text/html")) {
      return {
        ok: false,
        reachable: false,
        row_count: null,
        fields: {},
        error: "platform-unprobeable: returned-html (not a JSON endpoint)",
      };
    }

    const schema = (await schemaRes.json()) as {
      fields?: Array<{ name: string; alias?: string }>;
      error?: unknown;
    };
    if (schema.error) return { ok: false, reachable: true, row_count: null, fields: {}, error: "arcgis token required" };
    // Extract both `name` (what queries use) and `alias` (human label —
    // often the only clue to the semantic role). Esri names like
    // PER_TYP_CD → alias "Permit Type" give us the hit via the alias pool.
    const schemaWithLabels = schema as unknown as { name?: string; serviceDescription?: string };
    const datasetName = [schemaWithLabels.name, schemaWithLabels.serviceDescription]
      .filter(Boolean).join(" ");
    const names = (schema.fields ?? []).map((f) => f.name.split(".").pop()!);
    const aliases: Record<string, string> = {};
    for (const f of schema.fields ?? []) {
      const shortName = f.name.split(".").pop()!;
      if (f.alias) aliases[shortName] = f.alias;
    }
    const mapping = inferMapping(names, aliases);

    let count: number | null = null;
    if (countRes.ok) {
      const cj = (await countRes.json()) as { count?: number };
      count = typeof cj.count === "number" ? cj.count : null;
    }

    // Gate (tightened after smoke-test caught non-permit datasets
    // passing on field-shape alone — see commit history):
    //   1. Must have spatial/temporal OR id+permit-shape fields
    //   2. AND must have a permit-topic keyword somewhere in the
    //      endpoint / dataset name / field list. Field-shape alone
    //      lit up water-boundary polygons, weather alerts, and
    //      park-and-ride locations as "permits".
    const hasSpatialOrTemporal = !!(mapping.address_field || mapping.date_field);
    const hasIdAndPermitShape = !!(
      mapping.id_field &&
      (mapping.type_field || mapping.status_field || mapping.desc_field)
    );
    const topical = looksLikePermitTopic(endpoint, [...names, ...Object.values(aliases)], datasetName);
    return {
      ok: (hasSpatialOrTemporal || hasIdAndPermitShape) && topical,
      reachable: true,
      row_count: count,
      fields: mapping,
    };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, reachable: false, row_count: null, fields: {}, error: (e as Error).message };
  }
}

/**
 * Normalize Socrata endpoint variants to the canonical SODA resource
 * shape. Catalogs ship URLs in several incompatible forms:
 *
 *   OK  {host}/resource/{id}.json
 *   OK  {host}/resource/{id}.json?$limit=5
 *   FIX {host}/api/views/{id}/rows.json?accessType=DOWNLOAD  (CSV export shape)
 *   FIX {host}/api/views/{id}.json                          (metadata-only)
 *   FIX {host}/d/{id}                                        (dataset landing page)
 *
 * Everything is rewritten to `{host}/resource/{id}.json` which is the
 * SODA row-query endpoint SODA-compliant clients expect.
 */
function normalizeSocrataEndpoint(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    // Already canonical
    if (/\/resource\/[a-z0-9-]+\.json$/i.test(u.pathname)) {
      return `${u.origin}${u.pathname}`;
    }
    // /api/views/{id}/rows.json or /api/views/{id}.json
    const viewsMatch = u.pathname.match(/\/api\/views\/([a-z0-9-]+)(?:\/|\.)/i);
    if (viewsMatch) {
      return `${u.origin}/resource/${viewsMatch[1]}.json`;
    }
    // /d/{id} dataset landing
    const dMatch = u.pathname.match(/^\/d\/([a-z0-9-]+)/i);
    if (dMatch) {
      return `${u.origin}/resource/${dMatch[1]}.json`;
    }
    return endpoint;
  } catch {
    return endpoint;
  }
}

async function probeSocrata(endpoint: string, datasetName?: string): Promise<ProbeResult> {
  // Rewrite non-canonical Socrata URL variants first — see normalize doc.
  const target = normalizeSocrataEndpoint(endpoint);

  // Socrata `.json` endpoint — sample first row to see fields
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const sampleUrl = target.includes("?")
      ? `${target}&$limit=1`
      : `${target}?$limit=1`;
    const res = await fetch(sampleUrl, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, reachable: false, row_count: null, fields: {}, error: `socrata ${res.status}` };
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, reachable: true, row_count: 0, fields: {}, error: "empty dataset" };
    }
    const names = Object.keys(rows[0]);
    const mapping = inferMapping(names);
    // Same tightened gate as ArcGIS — field shape + topic keyword.
    const hasSpatialOrTemporal = !!(mapping.address_field || mapping.date_field);
    const hasIdAndPermitShape = !!(
      mapping.id_field &&
      (mapping.type_field || mapping.status_field || mapping.desc_field)
    );
    // Pass the dataset name through the topical gate — catalog entries
    // often say "Code Enforcement All Cases" or "$10M Demolition List"
    // but the endpoint URL itself is a cryptic `resource/abc-xyz.json`
    // with no hint of topic. Without this, 35% of reachable-no-mapping
    // Socrata rows were permit-related but being rejected.
    const topical = looksLikePermitTopic(endpoint, names, datasetName);
    return {
      ok: (hasSpatialOrTemporal || hasIdAndPermitShape) && topical,
      reachable: true,
      row_count: null,
      fields: mapping,
      sample_row: rows[0],
    };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, reachable: false, row_count: null, fields: {}, error: (e as Error).message };
  }
}

/**
 * CKAN probe. CKAN catalog URLs come in two shapes:
 *   1. `{host}/dataset/{slug}` — dataset landing page; need package_show
 *      to discover the data resources.
 *   2. `{host}/datastore/dump/{id}.csv` — direct CSV download; probe as CSV.
 *
 * See Phase 5b.1.
 */
async function probeCKAN(endpoint: string): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);
  try {
    // Direct CSV — shortcut.
    if (/\.csv($|\?)/i.test(endpoint) || /\/datastore\/dump\//.test(endpoint)) {
      clearTimeout(timeout);
      return probeCSV(endpoint);
    }
    // Dataset slug — call package_show.
    const m = endpoint.match(/^(https?:\/\/[^/]+).*\/dataset\/([^/?#]+)/i);
    if (!m) {
      clearTimeout(timeout);
      return { ok: false, reachable: false, row_count: null, fields: {}, error: "CKAN URL not recognized" };
    }
    const [, host, slug] = m;
    const res = await fetch(`${host}/api/3/action/package_show?id=${slug}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, reachable: false, row_count: null, fields: {}, error: `ckan ${res.status}` };
    const j = (await res.json()) as {
      success?: boolean;
      result?: { resources?: Array<{ url?: string; format?: string; datastore_active?: boolean }> };
    };
    if (!j.success || !j.result?.resources?.length) {
      return { ok: false, reachable: true, row_count: null, fields: {}, error: "CKAN dataset has no resources" };
    }
    // Resource picker, tightened after Phase 1 landing-page audit caught
    // three CKAN rows passing the probe by falling through to
    // `resources[0]` — a PDF readme, a shape-file, and a GeoJSON boundary
    // with no permit columns. Priority now requires an actual probeable
    // data resource:
    //   1. datastore_active=true AND CSV format — canonical CKAN data API
    //   2. URL pointing to a .csv / .json / .geojson file we can parse
    // If neither matches, mark reachable-but-unprobeable so the scanner
    // skips it cleanly rather than inventing a mapping from a PDF header.
    const isDataResource = (r: { url?: string; format?: string; datastore_active?: boolean }): boolean => {
      if (!r.url) return false;
      const fmt = (r.format ?? "").toLowerCase();
      const url = r.url.toLowerCase();
      return /csv|json|geojson/.test(fmt) || /\.(csv|json|geojson)(\?|$)/.test(url);
    };
    const pick =
      j.result.resources.find((r) => r.datastore_active && /csv/i.test(r.format ?? "")) ??
      j.result.resources.find(isDataResource);
    if (!pick?.url) {
      return {
        ok: false,
        reachable: true,
        row_count: null,
        fields: {},
        error: "CKAN package has no datastore_active or probeable CSV/JSON resource",
      };
    }
    return probeCSV(pick.url);
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, reachable: false, row_count: null, fields: {}, error: (e as Error).message };
  }
}

/**
 * CSV probe. HEAD to check reachability, then grab first 8 KB and
 * parse the header row. No row-count — CSVs can be gigabytes; range
 * requests on the whole file would be abusive.
 *
 * See Phase 5b.2.
 */
async function probeCSV(endpoint: string): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(endpoint, {
      signal: ctrl.signal,
      // Range request grabs just the header + first data row.
      headers: { Range: "bytes=0-8192" },
    });
    clearTimeout(timeout);
    if (!res.ok && res.status !== 206) {
      return { ok: false, reachable: false, row_count: null, fields: {}, error: `csv ${res.status}` };
    }
    const text = await res.text();
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    if (!firstLine) return { ok: false, reachable: true, row_count: null, fields: {}, error: "empty csv" };
    // Naive comma split — good enough for header detection. Real ingest
    // handles quoted commas, but the header row is almost always unquoted.
    const names = firstLine.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    const mapping = inferMapping(names);
    const hasSpatialOrTemporal = !!(mapping.address_field || mapping.date_field);
    const hasIdAndPermitShape = !!(
      mapping.id_field &&
      (mapping.type_field || mapping.status_field || mapping.desc_field)
    );
    return {
      ok: hasSpatialOrTemporal || hasIdAndPermitShape,
      reachable: true,
      row_count: null,
      fields: mapping,
    };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, reachable: false, row_count: null, fields: {}, error: (e as Error).message };
  }
}

/**
 * Probe an endpoint based on source_type. Returns a uniform result shape
 * so the admin API can update the row consistently.
 *
 * `datasetName` is the `permit_sources.name` column — optional, but when
 * present it's routed into the topical-keyword gate. Catalogs frequently
 * encode the topic in the name ("Code Enforcement All Cases") rather
 * than in the endpoint URL, so this keeps field-shape-plus-topic gating
 * honest for platforms where the URL alone is a cryptic id.
 */
export async function probeSource(
  sourceType: string,
  endpoint: string,
  datasetName?: string,
): Promise<ProbeResult> {
  const t = sourceType.toLowerCase();
  if (t === "arcgis") return probeArcGIS(endpoint);
  if (t === "socrata") return probeSocrata(endpoint, datasetName);
  if (t === "ckan") return probeCKAN(endpoint);
  if (t === "csv") return probeCSV(endpoint);
  // Accela / eTrakit / Tyler / custom — HTML-scrape portals that can't
  // be probed with a simple JSON fetch. Bulk script uses this return
  // shape to tag the row as platform-unprobeable and skip it forever.
  if (["accela", "etrakit", "tyler", "citizenserve", "viewpoint cloud", "mygovernmentonline"].includes(t)) {
    return {
      ok: false,
      reachable: false,
      row_count: null,
      fields: {},
      error: `platform-unprobeable: ${t} requires an HTML-scraping ingester, not a JSON probe`,
    };
  }
  return { ok: false, reachable: false, row_count: null, fields: {}, error: `no probe implemented for source_type=${sourceType}` };
}
