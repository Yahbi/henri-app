/* ── Free property enrichment via verified public parcel endpoints ───────
 *
 * Each lookup below has been directly probed against the live service
 * (see scripts/probe-endpoints.ts). Speculative endpoints that 404 or
 * return empty results have been removed — the public ArcGIS landscape
 * is messy, each jurisdiction publishes data differently, and guessing
 * URLs produces false-positive coverage.
 *
 * Coverage today (all free, no auth, no API keys):
 *   • Hartford CT  — full owner + year_built + sqft + last_sale
 *   • Los Angeles County CA — address + year_built + sqft (no owner)
 *   • New York City (5 boroughs) — owner + year_built + sqft + assessed
 *   • OpenStreetMap fallback (nationwide) — year_built + building levels
 *
 * Adding a new jurisdiction: run scripts/probe-endpoints.ts against the
 * candidate URL first. Only add here after the probe returns populated
 * feature data. Hardcoded speculation wastes cron budget on 404s.
 * ────────────────────────────────────────────────────────────────────── */

export interface ParcelHit {
  owner_name?: string | null;
  owner_first?: string | null;
  owner_last?: string | null;
  mailing_address?: string | null;
  year_built?: number | null;
  home_sqft?: number | null;
  lot_sqft?: number | null;
  assessed_value?: number | null;
  property_value?: number | null;
  last_sale_date?: string | null;
  last_sale_price?: number | null;
  owner_occupied?: boolean | null;
  source: string;
}

/** Generic ArcGIS REST `query` helper. Returns the first feature's
 * attributes, or null on error / empty. */
async function arcgisQuery(
  url: string,
  where: string,
  outFields: string[],
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    where,
    outFields: outFields.join(","),
    f: "json",
    returnGeometry: "false",
    resultRecordCount: "1",
  });
  try {
    const res = await fetch(`${url}?${params}`, {
      headers: {
        "User-Agent": "Henri Lead-Gen Platform (free-tier)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      features?: Array<{ attributes?: Record<string, unknown> }>;
      error?: unknown;
    };
    if (j.error) return null;
    const attrs = j?.features?.[0]?.attributes;
    if (!attrs) return null;
    // ArcGIS returns fully-qualified field names like "SCHEMA.TABLE.FIELD".
    // Flatten to short names so callers don't have to deal with the prefix.
    const flat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attrs)) {
      const short = k.split(".").pop() ?? k;
      // Prefer first non-null value when short-name collides (common on
      // joined tables — e.g. two `OBJECTID` fields from different tables).
      if (flat[short] == null) flat[short] = v;
    }
    return flat;
  } catch {
    return null;
  }
}

/* ── Jurisdiction queries (verified live) ───────────────────────────── */

/** Hartford CT — real endpoint. This service requires fully-qualified
 * field names in both WHERE and outFields (the short names produce 400s). */
async function queryHartfordCT(address: string): Promise<ParcelHit | null> {
  // Permits store addresses as "133 WESTBOURNE PKWY, HARTFORD, CT 06112".
  // Strip everything from the first comma onward before splitting.
  const streetPart = stripAddressTrailer(address);
  // Also strip unit/apt designators ("1 GOLD ST, #10G" → "1 GOLD ST").
  const cleanStreet = streetPart.replace(/\s*#.*$/i, "").replace(/\s+(APT|UNIT|STE|SUITE|#)\s*\S+.*$/i, "").trim();
  const m = cleanStreet.match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  const street = m[2].toUpperCase().replace(/'/g, "''");

  const T = "GISADMIN.CAMAGIS_Property_Details_w_ObjectID";
  const fields = [
    `${T}.OwnerFullName`, `${T}.Owner1FName`, `${T}.Owner1Last`,
    `${T}.MailingAddress1`, `${T}.City`, `${T}.State`, `${T}.Zip10`,
    `${T}.YearBuilt`, `${T}.GrossBuiltArea`, `${T}.TotFinishdArea`, `${T}.TotAcreage`,
    `${T}.TotApprsdValue`, `${T}.LastSaleDate`, `${T}.LastSalePrice`,
  ];

  // Different permit feeds ship street names with different suffix variants
  // ("ASYLUM AV", "ASYLUM AVE", "ASYLUM AVENUE"). LIKE on the root name
  // catches all forms. Start with the tightest match and widen if it misses.
  const streetRoot = street.replace(/\s+(ST|AVE|AV|DR|RD|BLVD|LN|CT|PL|WAY|TER|STREET|AVENUE|DRIVE|ROAD)\.?$/i, "").trim();
  const wheres = [
    `${T}.StreetNumberFrom='${houseNum}' AND UPPER(${T}.StreetName)='${street}'`,
    `${T}.StreetNumberFrom='${houseNum}' AND UPPER(${T}.StreetName) LIKE '${streetRoot}%'`,
  ];

  for (const where of wheres) {
    const a = await arcgisQuery(
      "https://gis.hartford.gov/arcgis/rest/services/AssessorParcels/MapServer/3/query",
      where,
      fields,
    );
    if (!a) continue;
    const acres = numOrNull(a.TotAcreage);
    return {
      owner_name: (a.OwnerFullName as string) ?? null,
      owner_first: (a.Owner1FName as string) ?? null,
      owner_last: (a.Owner1Last as string) ?? null,
      mailing_address: (a.MailingAddress1 as string) ?? null,
      year_built: numOrNull(a.YearBuilt),
      home_sqft: numOrNull(a.TotFinishdArea ?? a.GrossBuiltArea),
      // Hartford's TotAcreage is actually square feet already (values like
      // 6700 for a city lot). Store directly rather than multiplying by
      // 43560 — that produced obviously wrong lot sizes in testing.
      lot_sqft: acres,
      assessed_value: numOrNull(a.TotApprsdValue),
      last_sale_date: isoDateOrNull(a.LastSaleDate),
      last_sale_price: numOrNull(a.LastSalePrice),
      source: "Hartford CT Assessor",
    };
  }
  return null;
}

/** Los Angeles County CA — real endpoint. No owner field (privacy policy). */
async function queryLosAngelesCA(address: string): Promise<ParcelHit | null> {
  // Strip ", CITY, STATE ZIP" suffix that permits sometimes include.
  const safe = stripAddressTrailer(address).replace(/'/g, "''").toUpperCase();
  const a = await arcgisQuery(
    "https://arcgis.claritisoftware.com/server/rest/services/Hosted/LA_County_Parcels/FeatureServer/0/query",
    `UPPER(situsaddre) LIKE UPPER('${safe}%')`,
    ["situsaddre", "situscity", "situszip", "yearbuilt1", "sqftmain1"],
  );
  if (!a) return null;
  return {
    year_built: numOrNull(a.yearbuilt1),
    home_sqft: numOrNull(a.sqftmain1),
    source: "LA County Parcels (public)",
  };
}

/** NYC (all 5 boroughs) — NYC Open Data PLUTO via SoQL (no auth).
 * PLUTO stores street names in long form ("5 AVENUE" not "5 AVE"). We
 * try the address as-given first, then normalize common abbreviations. */
async function queryNYC(address: string, zip: string | null): Promise<ParcelHit | null> {
  // Strip ", CITY, STATE ZIP" suffix before splitting.
  const parts = stripAddressTrailer(address).split(/\s+/);
  if (parts.length < 2) return null;
  const houseNum = parts[0];
  const rawStreet = parts.slice(1).join(" ").replace(/'/g, "''").toUpperCase();

  // Normalize: "5 AVE" → "5 AVENUE", "MAIN ST" → "MAIN STREET", etc.
  const expansions: Record<string, string> = {
    " AVE": " AVENUE", " AV": " AVENUE",
    " ST": " STREET",
    " RD": " ROAD",
    " DR": " DRIVE",
    " BLVD": " BOULEVARD",
    " PL": " PLACE",
    " LN": " LANE",
  };
  const variants = new Set([rawStreet]);
  for (const [abbr, full] of Object.entries(expansions)) {
    if (rawStreet.endsWith(abbr)) variants.add(rawStreet.slice(0, -abbr.length) + full);
  }
  // Also try the root (no suffix) as a widest-net match.
  variants.add(rawStreet.replace(/\s+(STREET|AVENUE|ROAD|DRIVE|BOULEVARD|PLACE|LANE)$/i, ""));

  for (const street of variants) {
    try {
      const whereClauses: string[] = [`upper(address) like '${houseNum} ${street}%'`];
      if (zip) whereClauses.push(`zipcode='${zip}'`);
      const url = `https://data.cityofnewyork.us/resource/64uk-42ks.json?$where=${encodeURIComponent(whereClauses.join(" AND "))}&$limit=1`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const a = rows?.[0];
      if (!a) continue;
      return {
        owner_name: (a.ownername as string) ?? null,
        year_built: numOrNull(a.yearbuilt),
        home_sqft: numOrNull(a.bldgarea),
        lot_sqft: numOrNull(a.lotarea),
        assessed_value: numOrNull(a.assesstot),
        source: "NYC Open Data PLUTO",
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** Washington DC — ITSPE (tax roll) + RESIDENTIAL CAMA join for year built.
 * Two round-trips: first ITSPE by street name + address prefix to get the
 * SSL (parcel ID), then CAMA RESIDENTIAL by SSL for year_built + sqft. */
async function queryWashingtonDC(address: string): Promise<ParcelHit | null> {
  const street = stripAddressTrailer(address).replace(/'/g, "''").toUpperCase();
  // ITSPE exposes ADDRESS1 in form "1300 PENNSYLVANIA AVE NW" — match on prefix.
  const itspeBase = "https://maps2.dcgis.dc.gov/DCGIS/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/FeatureServer/53/query";
  const camaBase = "https://maps2.dcgis.dc.gov/DCGIS/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/FeatureServer/25/query";

  const itspe = await arcgisQuery(
    itspeBase,
    `UPPER(ADDRESS1) LIKE '${street}%'`,
    ["SSL", "OWNERNAME", "OWNNAME2", "ADDRESS1", "CITYSTZIP", "LANDAREA", "ASSESSMENT", "SALEDATE", "SALEPRICE"],
  );
  if (!itspe) return null;

  const ssl = itspe.SSL as string | undefined;
  let yearBuilt: number | null = null;
  let gba: number | null = null;
  if (ssl) {
    const cama = await arcgisQuery(
      camaBase,
      `SSL='${ssl.replace(/'/g, "''")}'`,
      ["SSL", "AYB", "EYB", "GBA", "BEDRM", "BATHRM"],
    );
    if (cama) {
      yearBuilt = numOrNull(cama.AYB ?? cama.EYB);
      gba = numOrNull(cama.GBA);
    }
  }

  return {
    owner_name: (itspe.OWNERNAME as string) ?? null,
    mailing_address: (itspe.ADDRESS1 as string) ?? null,
    year_built: yearBuilt,
    home_sqft: gba,
    lot_sqft: numOrNull(itspe.LANDAREA),
    assessed_value: numOrNull(itspe.ASSESSMENT),
    last_sale_date: isoDateOrNull(itspe.SALEDATE),
    last_sale_price: numOrNull(itspe.SALEPRICE),
    source: "DC Office of Tax & Revenue",
  };
}

/** Maryland — STATEWIDE via MD iMAP. Exposes every parcel in every MD
 * jurisdiction. Note: public endpoint strips owner name (privacy) but
 * includes year built, sqft, acres, assessed value, sale date/price,
 * AND the owner's mailing address (useful for direct-mail outreach). */
async function queryMaryland(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1];
  let street = m[2].toUpperCase().replace(/'/g, "''");
  street = street.replace(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+/i, "");
  street = street.replace(/\s+(ST|AVE|AV|DR|RD|BLVD|LN|CT|PL|WAY|TER|CIR|STREET|AVENUE|DRIVE|ROAD|CIRCLE)\.?$/i, "").trim();
  const a = await arcgisQuery(
    "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query",
    `STRTNUM=${houseNum} AND UPPER(STRTNAM)='${street}'`,
    ["ADDRESS", "CITY", "ZIPCODE", "OWNADD1", "OWNCITY", "OWNSTATE", "OWNERZIP",
     "YEARBLT", "SQFTSTRC", "ACRES", "LANDAREA",
     "NFMLNDVL", "NFMIMPVL", "NFMTTLVL", "TRADATE", "CONSIDR1"],
  );
  if (!a) return null;
  // Parse YYYYMMDD into ISO.
  const trad = a.TRADATE as string | null;
  const tradeIso = trad && /^\d{8}$/.test(trad)
    ? `${trad.slice(0, 4)}-${trad.slice(4, 6)}-${trad.slice(6, 8)}`
    : null;
  const yrBlt = numOrNull(a.YEARBLT);
  return {
    // MD strips owner name from public endpoint. Mailing address IS public
    // and is enough for direct mail outreach.
    mailing_address: [a.OWNADD1, a.OWNCITY, a.OWNSTATE, a.OWNERZIP].filter(Boolean).join(", ") || null,
    year_built: yrBlt && yrBlt >= 1700 && yrBlt <= 2100 ? yrBlt : null,
    home_sqft: numOrNull(a.SQFTSTRC),
    lot_sqft: numOrNull(a.ACRES) != null ? Math.round(numOrNull(a.ACRES)! * 43560) : null,
    assessed_value: numOrNull(a.NFMTTLVL),
    last_sale_date: tradeIso,
    last_sale_price: numOrNull(a.CONSIDR1),
    source: "Maryland iMAP (SDAT)",
  };
}

/** Harris County TX (Houston) — HCAD public MapServer. Schema uses integer
 * site_str_num and separate site_str_name (no suffix) / site_str_sfx. */
async function queryHarrisTX(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1];
  let street = m[2].toUpperCase().replace(/'/g, "''");
  street = street.replace(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+/i, "");
  street = street.replace(/\s+(ST|AVE|AV|DR|RD|BLVD|LN|CT|PL|WAY|TER|CIR|STREET|AVENUE|DRIVE|ROAD|CIRCLE)\.?$/i, "").trim();
  const a = await arcgisQuery(
    "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query",
    `site_str_num=${houseNum} AND UPPER(site_str_name)='${street}'`,
    ["owner_name_1", "owner_name_2", "mail_addr_1", "mail_city", "mail_state", "mail_zip",
     "site_str_num", "site_str_name", "site_str_sfx", "site_zip",
     "land_sqft", "total_appraised_val", "total_market_val", "bld_value",
     "land_value", "new_owner_date"],
  );
  if (!a) return null;
  const mailing = [a.mail_addr_1, a.mail_city, a.mail_state, a.mail_zip].filter(Boolean).join(", ");
  return {
    owner_name: (a.owner_name_1 as string)?.trim() || null,
    mailing_address: mailing || null,
    lot_sqft: numOrNull(a.land_sqft),
    assessed_value: numOrNull(a.total_appraised_val),
    property_value: numOrNull(a.total_market_val),
    last_sale_date: isoDateOrNull(a.new_owner_date),
    source: "Harris County TX (HCAD)",
  };
}

/** North Carolina — STATEWIDE parcels for all 100 counties via NC OneMap.
 * Rich schema: owner name + first/last split, mailing address, year built
 * (structyear), parcel value, land value, gisacres, sale date.
 *
 * County-name scoping is critical — without it, "123 MAIN ST" will match
 * whichever county has the lowest OBJECTID for that address combo, which
 * is usually wrong. We pass county via the `county` arg and use it as a
 * UPPER LIKE filter against `cntyname`. */
async function queryNorthCarolina(address: string, county: string | null): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  // Strip leading cardinal + trailing suffix — NC OneMap stores saddstname
  // as the root street name (e.g., "MAIN" not "N MAIN ST").
  let street = m[2].toUpperCase().replace(/'/g, "''");
  street = street.replace(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+/i, "");
  street = street.replace(/\s+(ST|AVE|AV|DR|RD|BLVD|LN|CT|PL|WAY|TER|CIR|STREET|AVENUE|DRIVE|ROAD|CIRCLE)\.?$/i, "").trim();

  // Best-effort city → county name map. NC OneMap's cntyname is the actual
  // county (e.g., "WAKE", not "RALEIGH"), so a raw `city` filter won't
  // match. For unmapped cities we fall back to a scity (site-city) filter
  // which DOES match the lead's city value.
  const CITY_TO_COUNTY: Record<string, string> = {
    raleigh: "WAKE", cary: "WAKE", apex: "WAKE", morrisville: "WAKE",
    charlotte: "MECKLENBURG", matthews: "MECKLENBURG", "mint hill": "MECKLENBURG",
    durham: "DURHAM",
    greensboro: "GUILFORD", "high point": "GUILFORD",
    "winston-salem": "FORSYTH", "winston salem": "FORSYTH",
    asheville: "BUNCOMBE",
    fayetteville: "CUMBERLAND",
    wilmington: "NEW HANOVER",
    greenville: "PITT",
    concord: "CABARRUS",
  };

  const whereParts = [
    `saddno='${houseNum}'`,
    `UPPER(saddstname) LIKE '${street}%'`,
  ];
  const cityLower = (county ?? "").toLowerCase().trim();
  const mappedCounty = CITY_TO_COUNTY[cityLower];
  if (mappedCounty) {
    whereParts.push(`UPPER(cntyname)='${mappedCounty}'`);
  } else if (county) {
    // Try filtering by site-city (scity) — the lead schema stored the
    // actual city, and NC OneMap has an scity field per parcel.
    const safeCity = county.replace(/'/g, "''").toUpperCase();
    whereParts.push(`UPPER(scity)='${safeCity}'`);
  }

  let a = await arcgisQuery(
    "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1/query",
    whereParts.join(" AND "),
    ["ownname", "ownfrst", "ownlast", "mailadd", "mcity", "mstate", "mzip",
     "siteadd", "scity", "szip", "parval", "landval", "structyear", "gisacres",
     "saledate", "cntyname"],
  );

  // If the strict filter missed, retry without any location filter — accept
  // the risk of grabbing the wrong county when only one match exists.
  if (!a) {
    a = await arcgisQuery(
      "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1/query",
      `saddno='${houseNum}' AND UPPER(saddstname) LIKE '${street}%'`,
      ["ownname", "ownfrst", "ownlast", "mailadd", "mcity", "mstate", "mzip",
       "siteadd", "scity", "szip", "parval", "landval", "structyear", "gisacres",
       "saledate", "cntyname"],
    );
  }
  if (!a) return null;
  const year = numOrNull(a.structyear);
  const mailing = [a.mailadd, a.mcity, a.mstate, a.mzip].filter(Boolean).join(", ").replace(/-\s*0000/g, "");
  return {
    owner_name: (a.ownname as string)?.trim() || null,
    owner_first: (a.ownfrst as string)?.trim() || null,
    owner_last: (a.ownlast as string)?.trim() || null,
    mailing_address: mailing || null,
    // structyear=0 means "unknown"; don't store.
    year_built: year && year >= 1700 && year <= 2100 ? year : null,
    lot_sqft: numOrNull(a.gisacres) != null ? Math.round(numOrNull(a.gisacres)! * 43560) : null,
    property_value: numOrNull(a.parval),
    last_sale_date: isoDateOrNull(a.saledate),
    source: `NC OneMap (${a.cntyname ?? "statewide"})`,
  };
}

/** Sioux Falls SD — city parcel service. No year_built field but owner +
 * sqft are rich. Schema uses PARHOUSE + PARSTREET — PARSTREET has BOTH
 * the leading direction prefix (N/S/E/W) AND the suffix (AVE/ST/etc)
 * stripped. Example: "340 N French Ave" → PARHOUSE='340', PARSTREET='FRENCH'. */
async function querySiouxFallsSD(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  let street = m[2].toUpperCase().replace(/'/g, "''");
  // Strip leading cardinal direction.
  street = street.replace(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+/i, "");
  // Strip trailing suffix.
  street = street.replace(/\s+(ST|AVE|AV|DR|RD|BLVD|LN|CT|PL|WAY|TER|CIR|STREET|AVENUE|DRIVE|ROAD|CIRCLE)\.?$/i, "").trim();
  const a = await arcgisQuery(
    "https://gis.siouxfalls.gov/arcgis/rest/services/Data/Property/MapServer/1/query",
    `PARHOUSE='${houseNum}' AND PARSTREET LIKE '${street}%'`,
    ["ADDRESS", "OWNNAME1", "OWNNAME2", "OWNADDRESS", "OWNCITY", "OWNSTATE", "OWNZIP", "SQFT", "PARHOUSE", "PARSTREET"],
  );
  if (!a) return null;
  const ownMailing = [a.OWNADDRESS, a.OWNCITY, a.OWNSTATE, a.OWNZIP].filter(Boolean).join(", ");
  return {
    owner_name: (a.OWNNAME1 as string) ?? null,
    mailing_address: ownMailing || null,
    lot_sqft: numOrNull(a.SQFT),
    source: "Sioux Falls SD Parcels",
  };
}

/* ── OpenStreetMap fallback (nationwide, sparse) ───────────────────── */

/**
 * OpenStreetMap via Nominatim (geocode) returns building-level `extratags`
 * that sometimes include `start_date` (year built) and `building:levels`.
 * Nationwide coverage but extremely sparse — ~5-15% of US buildings have
 * any useful extratags. Use as the last-resort fallback.
 *
 * Policy: 1 req/sec from a single IP, User-Agent required.
 */
async function queryOSMBuilding(
  address: string,
  zip: string | null,
): Promise<ParcelHit | null> {
  try {
    const q = [address, zip, "USA"].filter(Boolean).join(", ");
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&extratags=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Henri Lead-Gen Platform (free-tier)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ extratags?: Record<string, string> }>;
    const ex = rows?.[0]?.extratags ?? {};
    const yearBuilt = numOrNull(ex.start_date ?? ex["building:year_built"]);
    const levels = numOrNull(ex["building:levels"]);
    if (!yearBuilt && !levels) return null;
    return {
      year_built: yearBuilt,
      // Rough home_sqft estimate when we only know levels. US median
      // single-family footprint is ~1,000 sqft/floor. Caller can
      // overwrite with a real number when county data becomes available.
      home_sqft: levels ? levels * 1000 : null,
      source: "OpenStreetMap",
    };
  } catch {
    return null;
  }
}

/* ── Registry ───────────────────────────────────────────────────────── */

const COUNTY_LOOKUPS: Array<{
  match: (state: string, county: string) => boolean;
  // Lambdas can ignore any trailing arg they don't need (TS allows
  // narrower function types when spread). `city` is currently only
  // consumed by NC OneMap for county disambiguation.
  fn: (
    address: string,
    zip?: string | null,
    city?: string | null,
  ) => Promise<ParcelHit | null>;
}> = [
  {
    match: (s, c) => s === "CT" && (c === "" || c.includes("hartford")),
    fn: (addr) => queryHartfordCT(addr),
  },
  {
    match: (s, c) => s === "CA" && (c === "" || c.includes("los angeles") || c === "la"),
    fn: (addr) => queryLosAngelesCA(addr),
  },
  {
    match: (s, c) => s === "NY" && (
      c === "" || c.includes("new york") || c.includes("manhattan") ||
      c.includes("brooklyn") || c.includes("queens") || c.includes("bronx") ||
      c.includes("staten") || c === "kings" || c === "richmond"
    ),
    fn: (addr, zip) => queryNYC(addr, zip ?? null),
  },
  {
    // DC is both state and "county" in our schema (state="DC", city="Washington").
    match: (s, c) => s === "DC" || (s === "" && c === "washington"),
    fn: (addr) => queryWashingtonDC(addr),
  },
  {
    match: (s, c) => s === "SD" && (c === "" || c.includes("sioux falls") || c.includes("minnehaha")),
    fn: (addr) => querySiouxFallsSD(addr),
  },
  {
    // NC OneMap — statewide, covers all 100 counties in one endpoint.
    // City name from the lead schema doubles as the county-disambiguation
    // filter (most NC cities sit in a single named county).
    match: (s) => s === "NC",
    fn: (addr, _zip, city) => queryNorthCarolina(addr, city ?? null),
  } as { match: (s: string, c: string) => boolean; fn: (a: string, z?: string | null, c?: string | null) => Promise<ParcelHit | null> },
  {
    // Harris County TX — covers Houston, biggest TX lead bucket.
    match: (s, c) => s === "TX" && (c === "" || c.includes("harris") || c.includes("houston")),
    fn: (addr) => queryHarrisTX(addr),
  },
  {
    // MD iMAP — statewide across all Maryland jurisdictions.
    match: (s) => s === "MD",
    fn: (addr) => queryMaryland(addr),
  },
];

/**
 * Look up parcel data for an address. Dispatches by state + optional county,
 * falling back to OpenStreetMap when no specialized endpoint matches.
 *
 * Returns null when no source yields any usable field.
 */
export async function enrichFromCounty(
  state: string | null,
  county: string | null,
  address: string,
  zip?: string | null,
): Promise<ParcelHit | null> {
  if (!address) return null;
  const st = (state ?? "").trim().toUpperCase();
  const co = (county ?? "").trim().toLowerCase();

  // Try jurisdiction-specific lookup first (highest data quality).
  for (const entry of COUNTY_LOOKUPS) {
    if (entry.match(st, co)) {
      const hit = await entry.fn(address, zip ?? null, county);
      if (hit) return hit;
    }
  }

  // Fallback — OpenStreetMap gives us year_built + building levels for
  // some fraction of buildings everywhere in the US.
  return queryOSMBuilding(address, zip ?? null);
}

/* ── Utilities ──────────────────────────────────────────────────────── */

/**
 * Strip trailing ", CITY, STATE ZIP" from a mixed address string.
 * Permits store addresses as "133 WESTBOURNE PKWY, HARTFORD, CT 06112"
 * but parcel services want just "133 WESTBOURNE PKWY".
 */
function stripAddressTrailer(address: string): string {
  // Drop everything from the first comma onward — the parcel services
  // already scope by jurisdiction so the city/state/zip trailer is dead
  // weight that breaks exact-match WHERE clauses.
  const commaIdx = address.indexOf(",");
  return (commaIdx > 0 ? address.slice(0, commaIdx) : address).trim();
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDateOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}
