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
 *   • Washington DC — owner + year_built + sqft + assessed + last_sale
 *   • Sioux Falls SD (Minnehaha) — owner + lot_sqft + mailing addr
 *   • North Carolina — statewide (100 counties) — owner + year + lot + value
 *   • Harris County TX (Houston) — owner + mailing + lot + values
 *   • Maryland — statewide — mailing addr + year + sqft + lot + value + sale
 *   • Maricopa County AZ (Phoenix) — owner + year + sqft + lot + value + sale
 *   • King County WA (Seattle) — lot_sqft + appraised land + improvement val
 *   • Miami-Dade County FL — year_built + sqft + lot + assessed (no owner)
 *   • Denver CO — owner + mailing + year + sqft + value + sale year
 *   • Nashville/Davidson County TN — owner + mailing + lot + appraised + sale
 *   • Hillsborough County FL (Tampa) — owner + last sale + full address
 *   • Philadelphia PA — owner + year + sqft + lot + value + sale (OPA via Carto)
 *   • Detroit MI — owner + year + sqft + lot + assessed + sale
 *   • San Francisco CA — year + sqft + lot + assessed + last sale (no owner)
 *   • Hennepin County MN (Minneapolis) — owner + mailing + market value + sale
 *   • Portland OR — owner + mailing + year + sqft + value + sale
 *   • Fulton County GA (Atlanta) — owner + mailing + lot acres + address
 *   • Milwaukee WI — owner + mailing + year + sqft + assessed + sale
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

/** Maricopa County AZ (Phoenix) — Assessor RED MapServer layer 1.
 * Schema stores PropertyStreetName as the ROOT name (prefix direction +
 * suffix stripped — "301 W VERNON AVE" → PropertyStreetNumber='301',
 * PropertyStreetName='VERNON'). Exact equality on the root name works. */
async function queryMaricopaAZ(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  let street = m[2].toUpperCase().replace(/'/g, "''");
  street = street.replace(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+/i, "");
  street = street.replace(/\s+(ST|AVE|AV|DR|RD|BLVD|LN|CT|PL|WAY|TER|CIR|STREET|AVENUE|DRIVE|ROAD|CIRCLE)\.?$/i, "").trim();
  const a = await arcgisQuery(
    "https://gis.maricopa.gov/arcgis/rest/services/RED/Assessor/MapServer/1/query",
    `PropertyStreetNumber='${houseNum}' AND UPPER(PropertyStreetName)='${street}'`,
    ["OwnerName", "OwnerAddressLine1", "OwnerCity", "OwnerState", "OwnerZipCode",
     "PropertyFullStreetAddress", "PropertyZipCode",
     "ConstructionYear", "LivableArea_SqFt", "LotSize_SqFt",
     "FullCashValue", "LandFullCashValue", "ImprovementFullCashValue",
     "SaleDate", "SalePrice", "PropertyUseDescription"],
  );
  if (!a) return null;
  const mailing = [a.OwnerAddressLine1, a.OwnerCity, a.OwnerState, a.OwnerZipCode].filter(Boolean).join(", ");
  const yr = numOrNull(a.ConstructionYear);
  return {
    owner_name: (a.OwnerName as string)?.trim() || null,
    mailing_address: mailing || null,
    year_built: yr && yr >= 1700 && yr <= 2100 ? yr : null,
    home_sqft: numOrNull(a.LivableArea_SqFt),
    lot_sqft: numOrNull(a.LotSize_SqFt),
    assessed_value: numOrNull(a.FullCashValue),
    last_sale_date: isoDateOrNull(a.SaleDate),
    last_sale_price: numOrNull(a.SalePrice),
    source: "Maricopa County AZ Assessor",
  };
}

/** King County WA (Seattle) — PropertyInfo MapServer layer 2. Schema keeps
 * ADDR_HN (house number as string) separate from ADDR_FULL (full street
 * address like "500 4TH AVE"). No owner name or year_built (parcel-level
 * only), but land + improvement appraised value + lot sqft + use-type. */
async function queryKingCountyWA(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  const rest = m[2].toUpperCase().replace(/'/g, "''");
  // KingCo ADDR_FULL is the full "500 4TH AVE" string. Use a LIKE on the
  // complete "HN REST" prefix rather than fighting with direction/suffix
  // variants.
  const a = await arcgisQuery(
    "https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/2/query",
    `ADDR_HN='${houseNum}' AND UPPER(ADDR_FULL) LIKE '${houseNum} ${rest}%'`,
    ["ADDR_FULL", "ZIP5", "CTYNAME", "LOTSQFT", "KCA_ACRES",
     "APPRLNDVAL", "APPR_IMPR", "PREUSE_DESC"],
  );
  if (!a) return null;
  const land = numOrNull(a.APPRLNDVAL);
  const impr = numOrNull(a.APPR_IMPR);
  const totalVal = land != null || impr != null ? (land ?? 0) + (impr ?? 0) : null;
  return {
    lot_sqft: numOrNull(a.LOTSQFT),
    assessed_value: totalVal,
    source: "King County WA Assessor",
  };
}

/** Miami-Dade County FL — Property Appraiser PaParcelView. Rich schema:
 * TRUE_SITE_ADDR has the full street address, BEDROOM_COUNT/BATHROOM_COUNT,
 * BUILDING_HEATED_AREA (living area sqft), LOT_SIZE, YEAR_BUILT,
 * ASSESSED_VAL_CUR. No owner name published on this public view. */
async function queryMiamiDadeFL(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  const rest = m[2].toUpperCase().replace(/'/g, "''");
  const a = await arcgisQuery(
    "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/PaParcelView_gdb/FeatureServer/0/query",
    `UPPER(TRUE_SITE_ADDR) LIKE '${houseNum} ${rest}%'`,
    ["TRUE_SITE_ADDR", "TRUE_SITE_ZIP_CODE", "YEAR_BUILT",
     "BUILDING_HEATED_AREA", "BUILDING_ACTUAL_AREA", "LOT_SIZE",
     "ASSESSED_VAL_CUR", "BEDROOM_COUNT", "BATHROOM_COUNT", "DOR_DESC"],
  );
  if (!a) return null;
  const yr = numOrNull(a.YEAR_BUILT);
  return {
    year_built: yr && yr >= 1700 && yr <= 2100 ? yr : null,
    home_sqft: numOrNull(a.BUILDING_HEATED_AREA ?? a.BUILDING_ACTUAL_AREA),
    lot_sqft: numOrNull(a.LOT_SIZE),
    assessed_value: numOrNull(a.ASSESSED_VAL_CUR),
    source: "Miami-Dade FL Property Appraiser",
  };
}

/** Denver CO — City & County of Denver Parcels FeatureServer. Schema has
 * OWNER_NAME, OWNER_ADDR..OWNER_ZIP (mailing), SITUS_AD_1 (full site addr),
 * CCYRBLT (year built), IMP_AREA (sqft), LAND_VALUE + IMPROVEMEN = TOTAL_VALU,
 * SALE_YEAR. SITUS_ADDR is a parcel ID integer, NOT the house number — use
 * SITUS_AD_1 LIKE 'HN REST%' instead. */
async function queryDenverCO(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  const rest = m[2].toUpperCase().replace(/'/g, "''");
  const a = await arcgisQuery(
    "https://services.arcgis.com/ue9rwulIoeLEI9bj/arcgis/rest/services/Parcels/FeatureServer/0/query",
    `UPPER(SITUS_AD_1) LIKE '${houseNum} ${rest}%'`,
    ["OWNER_NAME", "OWNER_ADDR", "OWNER_CITY", "OWNER_STAT", "OWNER_ZIP",
     "SITUS_AD_1", "SITUS_CITY", "SITUS_ZIP",
     "LAND_VALUE", "IMPROVEMEN", "TOTAL_VALU",
     "CCYRBLT", "IMP_AREA", "SALE_YEAR"],
  );
  if (!a) return null;
  const yr = numOrNull(a.CCYRBLT);
  const saleYear = typeof a.SALE_YEAR === "string" ? a.SALE_YEAR.trim() : null;
  const mailing = [a.OWNER_ADDR, a.OWNER_CITY, a.OWNER_STAT, a.OWNER_ZIP].filter(Boolean).join(", ");
  return {
    owner_name: (a.OWNER_NAME as string)?.trim() || null,
    mailing_address: mailing || null,
    year_built: yr && yr >= 1700 && yr <= 2100 ? yr : null,
    home_sqft: numOrNull(a.IMP_AREA),
    assessed_value: numOrNull(a.TOTAL_VALU),
    // Denver only publishes SALE_YEAR (not full date). Store as jan 1 ISO
    // when present — downstream last_sale_date is used for recency buckets.
    last_sale_date: saleYear && /^\d{4}$/.test(saleYear) ? `${saleYear}-01-01` : null,
    source: "Denver CO Assessor",
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

/** Nashville / Davidson County TN — MetroGIS Cadastral/Parcels MapServer.
 * Schema splits the site address into PropHouse (string) + PropStreet (name
 * only — no suffix) + PropSuite. PropStreet is uppercased. Full sale price
 * + total appraised + owner + mailing are published. No year_built here. */
async function queryNashvilleTN(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  let street = m[2].toUpperCase().replace(/'/g, "''");
  street = street.replace(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+/i, "");
  street = street.replace(/\s+(ST|AVE|AV|DR|RD|BLVD|LN|CT|PL|WAY|TER|CIR|STREET|AVENUE|DRIVE|ROAD|CIRCLE|PIKE|PKWY)\.?$/i, "").trim();
  const a = await arcgisQuery(
    "https://maps.nashville.gov/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query",
    `PropHouse='${houseNum}' AND UPPER(PropStreet) LIKE '${street}%'`,
    ["PropAddr", "PropHouse", "PropStreet", "PropCity", "PropZip",
     "Owner", "OwnAddr1", "OwnCity", "OwnState", "OwnZip",
     "Acres", "SalePrice", "OwnDate", "LandAppr", "ImprAppr", "TotlAppr", "LUDesc"],
  );
  if (!a) return null;
  const acres = numOrNull(a.Acres);
  const mailing = [a.OwnAddr1, a.OwnCity, a.OwnState, a.OwnZip].filter(Boolean).join(", ");
  return {
    owner_name: (a.Owner as string)?.trim() || null,
    mailing_address: mailing || null,
    lot_sqft: acres != null ? Math.round(acres * 43560) : null,
    assessed_value: numOrNull(a.TotlAppr),
    last_sale_date: isoDateOrNull(a.OwnDate),
    last_sale_price: numOrNull(a.SalePrice),
    source: "Nashville/Davidson County TN Metro",
  };
}

/** Hillsborough County FL (Tampa) — HCPA WebParcels layer 0. Stores
 * FullAddress as "601 E KENNEDY BLVD" style. Owner1 + TopSaleDate +
 * TopSalePrice published. No year_built on the public WebParcels view. */
async function queryHillsboroughFL(address: string): Promise<ParcelHit | null> {
  const safe = stripAddressTrailer(address).replace(/'/g, "''").toUpperCase();
  const a = await arcgisQuery(
    "https://gis.hcpafl.org/arcgis/rest/services/Webmaps/HillsboroughFL_WebParcels/MapServer/0/query",
    `UPPER(FullAddress) LIKE '${safe}%'`,
    ["FullAddress", "SiteCity", "SiteZip", "Owner1", "Owner2",
     "TopSaleDate", "TopSalePrice", "Homestead"],
  );
  if (!a) return null;
  const owner = [a.Owner1, a.Owner2].filter(Boolean).join(" & ").trim();
  return {
    owner_name: owner || null,
    last_sale_date: isoDateOrNull(a.TopSaleDate),
    last_sale_price: numOrNull(a.TopSalePrice),
    owner_occupied: typeof a.Homestead === "string"
      ? a.Homestead.trim().toUpperCase() === "Y"
      : null,
    source: "Hillsborough County FL (HCPA)",
  };
}

/** Philadelphia PA — OPA properties via Carto SQL API. Rich schema:
 * owner_1 + mailing_street/city_state/zip, year_built (nullable),
 * market_value, total_livable_area, total_area, sale_date, sale_price. */
async function queryPhiladelphiaPA(address: string): Promise<ParcelHit | null> {
  const safe = stripAddressTrailer(address).replace(/'/g, "''").toUpperCase();
  try {
    const sql = `SELECT owner_1, mailing_street, mailing_city_state, mailing_zip, ` +
      `year_built, market_value, total_livable_area, total_area, ` +
      `sale_date, sale_price, location ` +
      `FROM opa_properties_public WHERE UPPER(location) LIKE '${safe}%' LIMIT 1`;
    const url = `https://phl.carto.com/api/v2/sql?q=${encodeURIComponent(sql)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Henri Lead-Gen Platform (free-tier)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { rows?: Array<Record<string, unknown>>; error?: unknown };
    if (j.error) return null;
    const a = j?.rows?.[0];
    if (!a) return null;
    const mailing = [a.mailing_street, a.mailing_city_state, a.mailing_zip].filter(Boolean).join(", ");
    const yr = numOrNull(a.year_built);
    return {
      owner_name: (a.owner_1 as string)?.trim() || null,
      mailing_address: mailing || null,
      year_built: yr && yr >= 1700 && yr <= 2100 ? yr : null,
      home_sqft: numOrNull(a.total_livable_area),
      lot_sqft: numOrNull(a.total_area),
      assessed_value: numOrNull(a.market_value),
      last_sale_date: isoDateOrNull(a.sale_date),
      last_sale_price: numOrNull(a.sale_price),
      source: "Philadelphia OPA",
    };
  } catch {
    return null;
  }
}

/** Detroit MI — open data parcel_file_current FeatureServer. Rich: address
 * (full site addr), taxpayer_1 + mailing, year_built, total_floor_area,
 * total_acreage, amt_assessed_value, sale_date + amt_sale_price. */
async function queryDetroitMI(address: string): Promise<ParcelHit | null> {
  const safe = stripAddressTrailer(address).replace(/'/g, "''").toUpperCase();
  const a = await arcgisQuery(
    "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0/query",
    `UPPER(address) LIKE '${safe}%'`,
    ["address", "zip_code", "taxpayer_1", "taxpayer_2", "taxpayer_address",
     "taxpayer_city", "taxpayer_state", "taxpayer_zip_code",
     "year_built", "total_floor_area", "total_square_footage", "total_acreage",
     "amt_assessed_value", "sale_date", "amt_sale_price", "use_code_description"],
  );
  if (!a) return null;
  const mailing = [a.taxpayer_address, a.taxpayer_city, a.taxpayer_state, a.taxpayer_zip_code]
    .filter(Boolean).join(", ");
  const yr = numOrNull(a.year_built);
  const acres = numOrNull(a.total_acreage);
  return {
    owner_name: (a.taxpayer_1 as string)?.trim() || null,
    mailing_address: mailing || null,
    year_built: yr && yr >= 1700 && yr <= 2100 ? yr : null,
    home_sqft: numOrNull(a.total_floor_area),
    lot_sqft: numOrNull(a.total_square_footage) ??
      (acres != null ? Math.round(acres * 43560) : null),
    assessed_value: numOrNull(a.amt_assessed_value),
    last_sale_date: isoDateOrNull(a.sale_date),
    last_sale_price: numOrNull(a.amt_sale_price),
    source: "Detroit MI Assessor",
  };
}

/** San Francisco CA — assessor roll via Socrata (dataset wv5m-vpq2).
 * property_location is padded with leading/trailing spaces / unit number
 * ("0000 1250 JONES               ST0202"). LIKE with wildcards on the
 * address substring works reliably. Public roll strips owner name; land +
 * improvement values + year_built + sqft + sale date are published. */
async function querySanFranciscoCA(address: string): Promise<ParcelHit | null> {
  const safe = stripAddressTrailer(address).replace(/'/g, "''").toUpperCase();
  try {
    // Pull the most-recent available tax-year row (Socrata `$order` sorts
    // on string values, but closed_roll_year is a 4-digit year so lexical
    // DESC == chronological DESC).
    const where = `UPPER(property_location) like '%${safe}%' AND closed_roll_year > '2020'`;
    const url = `https://data.sfgov.org/resource/wv5m-vpq2.json?$where=${encodeURIComponent(where)}&$order=closed_roll_year+DESC&$limit=1`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Henri Lead-Gen Platform (free-tier)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const a = rows?.[0];
    if (!a) return null;
    const yr = numOrNull(a.year_property_built);
    const land = numOrNull(a.assessed_land_value);
    const impr = numOrNull(a.assessed_improvement_value);
    const total = land != null || impr != null ? (land ?? 0) + (impr ?? 0) : null;
    return {
      year_built: yr && yr >= 1700 && yr <= 2100 ? yr : null,
      home_sqft: numOrNull(a.property_area),
      lot_sqft: numOrNull(a.lot_area),
      assessed_value: total,
      last_sale_date: isoDateOrNull(a.current_sales_date),
      source: "San Francisco CA Assessor",
    };
  } catch {
    return null;
  }
}

/** Hennepin County MN (Minneapolis) — LAND_PROPERTY/MapServer/1 County
 * Parcels. HOUSE_NO is an integer, STREET_NM is the full street name
 * including suffix ("78TH ST E"). TOTAL_MV1 is the primary market value.
 * SALE_DATE is a string in YYYYMM format. No year_built field. */
async function queryHennepinMN(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1];
  let street = m[2].toUpperCase().replace(/'/g, "''");
  // Strip leading direction; keep suffix since STREET_NM includes it.
  street = street.replace(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+/i, "");
  const a = await arcgisQuery(
    "https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1/query",
    `HOUSE_NO=${houseNum} AND UPPER(STREET_NM) LIKE '${street}%'`,
    ["HOUSE_NO", "STREET_NM", "ZIP_CD", "OWNER_NM", "TAXPAYER_NM_1",
     "MUNIC_NM", "MAILING_MUNIC_NM", "TOTAL_MV1",
     "SALE_DATE", "SALE_PRICE", "PARCEL_AREA"],
  );
  if (!a) return null;
  // SALE_DATE is "YYYYMM" (6 chars). Convert to ISO with day=1.
  const sd = typeof a.SALE_DATE === "string" ? a.SALE_DATE.trim() : null;
  const saleIso = sd && /^\d{6}$/.test(sd)
    ? `${sd.slice(0, 4)}-${sd.slice(4, 6)}-01`
    : null;
  const mailing = [a.TAXPAYER_NM_1, a.MAILING_MUNIC_NM].filter(Boolean).join(", ").trim();
  return {
    owner_name: (a.OWNER_NM as string)?.trim() || null,
    mailing_address: mailing || null,
    lot_sqft: numOrNull(a.PARCEL_AREA),
    assessed_value: numOrNull(a.TOTAL_MV1),
    last_sale_date: saleIso,
    last_sale_price: numOrNull(a.SALE_PRICE),
    source: "Hennepin County MN Assessor",
  };
}

/** Portland OR — Portland Metro Taxlots (regional, covers Multnomah +
 * parts of Washington + Clackamas counties). SITEADDR is the full site
 * address, YEARBUILT is a string, OWNER1 + OWNERADDR/CITY/STATE/ZIP,
 * TOTALVAL1 = current market value, SALEDATE + SALEPRICE. Dumped
 * SALEDATE "01/01/1900" sentinels indicate no real recorded sale. */
async function queryPortlandOR(address: string): Promise<ParcelHit | null> {
  const safe = stripAddressTrailer(address).replace(/'/g, "''").toUpperCase();
  const a = await arcgisQuery(
    "https://www.portlandmaps.com/arcgis/rest/services/Public/Taxlots/MapServer/0/query",
    `UPPER(SITEADDR) LIKE '${safe}%'`,
    ["OWNER1", "OWNERADDR", "OWNERCITY", "OWNERSTATE", "OWNERZIP",
     "SITEADDR", "SITECITY", "SITEZIP",
     "YEARBUILT", "BLDGSQFT", "LANDVAL1", "BLDGVAL1", "TOTALVAL1",
     "SALEDATE", "SALEPRICE", "PRPCD_DESC"],
  );
  if (!a) return null;
  const yr = numOrNull(a.YEARBUILT);
  const mailing = [a.OWNERADDR, a.OWNERCITY, a.OWNERSTATE, a.OWNERZIP].filter(Boolean).join(", ");
  const land = numOrNull(a.LANDVAL1);
  const impr = numOrNull(a.BLDGVAL1);
  const total = numOrNull(a.TOTALVAL1) ||
    (land != null || impr != null ? (land ?? 0) + (impr ?? 0) : null);
  const saleRaw = typeof a.SALEDATE === "string" ? a.SALEDATE.trim() : null;
  // Reject the "01/01/1900" placeholder.
  const saleIso = saleRaw && !saleRaw.startsWith("01/01/1900")
    ? isoDateOrNull(saleRaw)
    : null;
  const salePrice = numOrNull(a.SALEPRICE);
  return {
    owner_name: (a.OWNER1 as string)?.trim() || null,
    mailing_address: mailing || null,
    year_built: yr && yr >= 1700 && yr <= 2100 ? yr : null,
    home_sqft: numOrNull(a.BLDGSQFT),
    assessed_value: total,
    last_sale_date: saleIso,
    last_sale_price: salePrice && salePrice > 0 ? salePrice : null,
    source: "Portland OR Metro Taxlots",
  };
}

/** Fulton County GA (Atlanta) — East Point GIS-hosted Tax_Parcels.
 * AddrNumber is a STRING, AddrStreet is the name only (no pre-dir /
 * suffix). Owner + OwnerAddr1 + LandAcres. No year_built / sqft in the
 * public tax parcels view. */
async function queryFultonGA(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  let street = m[2].toUpperCase().replace(/'/g, "''");
  street = street.replace(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+/i, "");
  street = street.replace(/\s+(ST|AVE|AV|DR|RD|BLVD|LN|CT|PL|WAY|TER|CIR|STREET|AVENUE|DRIVE|ROAD|CIRCLE|PKWY)\.?$/i, "").trim();
  const a = await arcgisQuery(
    "https://services1.arcgis.com/AQDHTHDrZzfsFsB5/arcgis/rest/services/Tax_Parcels/FeatureServer/0/query",
    `AddrNumber='${houseNum}' AND UPPER(AddrStreet) LIKE '${street}%'`,
    ["Address", "AddrNumber", "AddrStreet", "Owner",
     "OwnerAddr1", "OwnerAddr2", "LandAcres", "LUCode"],
  );
  if (!a) return null;
  const acres = numOrNull(a.LandAcres);
  const mailing = [a.OwnerAddr1, a.OwnerAddr2].filter(Boolean).join(", ");
  return {
    owner_name: (a.Owner as string)?.trim() || null,
    mailing_address: mailing || null,
    lot_sqft: acres != null ? Math.round(acres * 43560) : null,
    source: "Fulton County GA Assessor",
  };
}

/** Milwaukee WI — City of Milwaukee open data (CKAN) Master Property File.
 * Schema splits addr: HOUSE_NR_LO (string), SDIR (direction), STREET
 * (name only), STTYPE (suffix). OWNER_NAME_1 + OWNER_MAIL_ADDR published.
 * Use CKAN's datastore_search_sql endpoint. */
async function queryMilwaukeeWI(address: string): Promise<ParcelHit | null> {
  const m = stripAddressTrailer(address).match(/^(\d+[A-Z]?)\s+(.+?)$/i);
  if (!m) return null;
  const houseNum = m[1].replace(/'/g, "''");
  let street = m[2].toUpperCase().replace(/'/g, "''");
  street = street.replace(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+/i, "");
  street = street.replace(/\s+(ST|AVE|AV|DR|RD|BLVD|LN|CT|PL|WAY|TER|CIR|STREET|AVENUE|DRIVE|ROAD|CIRCLE|PKWY)\.?$/i, "").trim();
  const resourceId = "0a2c7f31-cd15-4151-8222-09dd57d5f16d";
  const sql =
    `SELECT "HOUSE_NR_LO","SDIR","STREET","STTYPE",` +
    `"OWNER_NAME_1","OWNER_MAIL_ADDR","OWNER_CITY_STATE","OWNER_ZIP",` +
    `"YR_BUILT","BLDG_AREA","LOT_AREA","C_A_TOTAL","CONVEY_DATE","CONVEY_FEE" ` +
    `FROM "${resourceId}" WHERE "HOUSE_NR_LO"='${houseNum}' AND "STREET"='${street}' LIMIT 1`;
  try {
    const url = `https://data.milwaukee.gov/api/3/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Henri Lead-Gen Platform (free-tier)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      success?: boolean;
      result?: { records?: Array<Record<string, unknown>> };
    };
    if (!j.success) return null;
    const a = j?.result?.records?.[0];
    if (!a) return null;
    const yr = numOrNull(a.YR_BUILT);
    const mailing = [a.OWNER_MAIL_ADDR, a.OWNER_CITY_STATE, a.OWNER_ZIP].filter(Boolean).join(", ");
    const fee = numOrNull(a.CONVEY_FEE);
    return {
      owner_name: (a.OWNER_NAME_1 as string)?.trim() || null,
      mailing_address: mailing || null,
      // YR_BUILT is "0" (string) for unknown.
      year_built: yr && yr >= 1700 && yr <= 2100 ? yr : null,
      home_sqft: numOrNull(a.BLDG_AREA),
      lot_sqft: numOrNull(a.LOT_AREA),
      assessed_value: numOrNull(a.C_A_TOTAL),
      last_sale_date: isoDateOrNull(a.CONVEY_DATE),
      last_sale_price: fee && fee > 0 ? fee : null,
      source: "Milwaukee WI Assessor",
    };
  } catch {
    return null;
  }
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

/** Florida Statewide Cadastral — fallback for FL counties not covered
 * by Miami-Dade or Hillsborough adapters. Layer is hosted by FDOR Property
 * Tax Oversight and aggregates ~67 county appraisers. Schema verified
 * 2026-05-07 in research/tier1b_county_parcels.md.
 *
 * Field summary (full 5/5 for Henri's score signals):
 *   PHY_ADDR1     situs street address
 *   OWN_NAME      owner name
 *   ACT_YR_BLT    actual year built
 *   TOT_LVG_AR    total living area sqft
 *   JV / TV_*     just / taxable values (assessed-value proxies)
 *
 * Used as fallback only — Miami-Dade + Hillsborough have richer
 * county-specific feeds. */
async function queryFloridaStatewide(address: string): Promise<ParcelHit | null> {
  const safe = stripAddressTrailer(address).replace(/'/g, "''").toUpperCase();
  const a = await arcgisQuery(
    "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query",
    `UPPER(PHY_ADDR1) LIKE UPPER('${safe}%')`,
    ["PHY_ADDR1", "PHY_CITY", "PHY_ZIPCD", "OWN_NAME", "OWN_ADDR1",
     "ACT_YR_BLT", "TOT_LVG_AR", "LND_SQFOOT", "JV", "TV_NSD", "S_LEGAL"],
  );
  if (!a) return null;
  return {
    owner_name: (a.OWN_NAME as string) ?? null,
    mailing_address: (a.OWN_ADDR1 as string) ?? null,
    year_built: numOrNull(a.ACT_YR_BLT),
    home_sqft: numOrNull(a.TOT_LVG_AR),
    lot_sqft: numOrNull(a.LND_SQFOOT),
    assessed_value: numOrNull(a.TV_NSD ?? a.JV),
    source: "Florida Statewide Cadastral",
  };
}

/** New York State Tax Parcels Public — covers ~30 NY counties that opted
 * into the NYS GIS sharing program: Suffolk, Westchester, Erie, Onondaga,
 * Albany, Rockland, Broome, Chautauqua, Dutchess, Saratoga, etc. Notable
 * holdout: Nassau (did not opt in). Fallback for non-NYC NY addresses.
 *
 * Field summary verified 2026-05-07:
 *   PARCEL_ADDR     situs address
 *   PRIMARY_OWNER   owner name
 *   YR_BLT          year built
 *   SQ_FT or SQFT_LIVING  living area
 *   TOTAL_AV        total assessed value
 *
 * Used as fallback only — NYC PLUTO covers the 5 boroughs with richer data. */
async function queryNYStatewide(address: string): Promise<ParcelHit | null> {
  const safe = stripAddressTrailer(address).replace(/'/g, "''").toUpperCase();
  const a = await arcgisQuery(
    "https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1/query",
    `UPPER(PARCEL_ADDR) LIKE UPPER('${safe}%')`,
    ["PARCEL_ADDR", "MUNI_NAME", "ZIP_CODE", "PRIMARY_OWNER",
     "YR_BLT", "SQ_FT", "SQFT_LIVING", "TOTAL_AV"],
  );
  if (!a) return null;
  return {
    owner_name: (a.PRIMARY_OWNER as string) ?? null,
    year_built: numOrNull(a.YR_BLT),
    home_sqft: numOrNull(a.SQFT_LIVING ?? a.SQ_FT),
    assessed_value: numOrNull(a.TOTAL_AV),
    source: "NY State Tax Parcels Public",
  };
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
  {
    // Maricopa County AZ — covers Phoenix + Scottsdale + Tempe + Mesa +
    // Glendale. Biggest single bucket of AZ permits.
    match: (s, c) => s === "AZ" && (
      c === "" || c.includes("maricopa") || c.includes("phoenix") ||
      c.includes("scottsdale") || c.includes("tempe") || c.includes("mesa") ||
      c.includes("glendale") || c.includes("chandler") || c.includes("peoria") ||
      c.includes("gilbert") || c.includes("surprise")
    ),
    fn: (addr) => queryMaricopaAZ(addr),
  },
  {
    // King County WA — covers Seattle + Bellevue + Redmond + Kirkland.
    match: (s, c) => s === "WA" && (
      c === "" || c.includes("king") || c.includes("seattle") ||
      c.includes("bellevue") || c.includes("redmond") || c.includes("kirkland") ||
      c.includes("renton") || c.includes("kent") || c.includes("federal way") ||
      c.includes("auburn") || c.includes("sammamish")
    ),
    fn: (addr) => queryKingCountyWA(addr),
  },
  {
    // Miami-Dade County FL — covers Miami + Miami Beach + Hialeah + Coral
    // Gables + Doral + Homestead. Miami-Dade publishes its own property
    // appraiser view, which is richer than the Florida statewide cadastral
    // (the statewide layer has no street-address field).
    match: (s, c) => s === "FL" && (
      c === "" || c.includes("miami") || c.includes("dade") ||
      c.includes("hialeah") || c.includes("coral gables") ||
      c.includes("doral") || c.includes("homestead") || c.includes("aventura")
    ),
    fn: (addr) => queryMiamiDadeFL(addr),
  },
  {
    // Denver CO — covers the City & County of Denver (single consolidated
    // city-county, so no other municipality names map here).
    match: (s, c) => s === "CO" && (c === "" || c.includes("denver")),
    fn: (addr) => queryDenverCO(addr),
  },
  {
    // Nashville / Davidson County TN — consolidated metro government.
    match: (s, c) => s === "TN" && (
      c === "" || c.includes("nashville") || c.includes("davidson") ||
      c.includes("antioch") || c.includes("hermitage") || c.includes("madison") ||
      c.includes("bellevue") || c.includes("goodlettsville")
    ),
    fn: (addr) => queryNashvilleTN(addr),
  },
  {
    // Hillsborough County FL — covers Tampa + Brandon + Plant City +
    // Riverview + Valrico + Temple Terrace.
    match: (s, c) => s === "FL" && (
      c.includes("tampa") || c.includes("hillsborough") || c.includes("brandon") ||
      c.includes("plant city") || c.includes("riverview") || c.includes("valrico") ||
      c.includes("temple terrace") || c.includes("lutz") || c.includes("carrollwood")
    ),
    fn: (addr) => queryHillsboroughFL(addr),
  },
  {
    // Philadelphia PA — consolidated city-county, so matches all of PA's
    // Philadelphia neighborhoods under the single county name.
    match: (s, c) => s === "PA" && (
      c === "" || c.includes("philadelphia") || c.includes("philly")
    ),
    fn: (addr) => queryPhiladelphiaPA(addr),
  },
  {
    // Detroit MI — city-level parcel dataset (Wayne County subset that
    // covers the City of Detroit only). For Wayne outside Detroit we fall
    // through to OSM.
    match: (s, c) => s === "MI" && (c === "" || c.includes("detroit")),
    fn: (addr) => queryDetroitMI(addr),
  },
  {
    // San Francisco CA — consolidated city-county. No other municipality
    // names map here (SF is both).
    match: (s, c) => s === "CA" && (
      c === "san francisco" || c.includes("san francisco")
    ),
    fn: (addr) => querySanFranciscoCA(addr),
  },
  {
    // Hennepin County MN — covers Minneapolis + Bloomington + Edina +
    // Minnetonka + Plymouth + Eden Prairie + Brooklyn Park + Maple Grove.
    match: (s, c) => s === "MN" && (
      c === "" || c.includes("hennepin") || c.includes("minneapolis") ||
      c.includes("bloomington") || c.includes("edina") || c.includes("minnetonka") ||
      c.includes("plymouth") || c.includes("eden prairie") ||
      c.includes("brooklyn park") || c.includes("maple grove") ||
      c.includes("st louis park") || c.includes("saint louis park") ||
      c.includes("richfield")
    ),
    fn: (addr) => queryHennepinMN(addr),
  },
  {
    // Portland OR — regional Taxlots service covers Multnomah + parts of
    // Washington and Clackamas counties (the tri-county Portland metro).
    match: (s, c) => s === "OR" && (
      c === "" || c.includes("portland") || c.includes("multnomah") ||
      c.includes("gresham") || c.includes("beaverton") || c.includes("hillsboro") ||
      c.includes("tigard") || c.includes("lake oswego") || c.includes("oregon city") ||
      c.includes("milwaukie") || c.includes("tualatin") || c.includes("washington") ||
      c.includes("clackamas")
    ),
    fn: (addr) => queryPortlandOR(addr),
  },
  {
    // Fulton County GA — covers Atlanta + Sandy Springs + Roswell +
    // Alpharetta + Johns Creek + Milton + East Point + College Park.
    match: (s, c) => s === "GA" && (
      c === "" || c.includes("fulton") || c.includes("atlanta") ||
      c.includes("sandy springs") || c.includes("roswell") || c.includes("alpharetta") ||
      c.includes("johns creek") || c.includes("milton") || c.includes("east point") ||
      c.includes("college park") || c.includes("union city")
    ),
    fn: (addr) => queryFultonGA(addr),
  },
  {
    // Milwaukee WI — city-level assessor dataset. Neighbouring municipal
    // assessors publish under their own systems, so this matches Milwaukee
    // city proper only.
    match: (s, c) => s === "WI" && (
      c === "" || c.includes("milwaukee")
    ),
    fn: (addr) => queryMilwaukeeWI(addr),
  },
  // ── State-level fallbacks (research/tier1b_county_parcels.md) ───────
  // Listed AFTER Miami-Dade + Hillsborough so the richer county-specific
  // adapters always run first. The statewide layer is the catch-all for
  // the remaining ~50 FL counties (Broward, Palm Beach, Duval, Pinellas,
  // Orange, etc.).
  {
    match: (s) => s === "FL",
    fn: (addr) => queryFloridaStatewide(addr),
  } as { match: (s: string, c: string) => boolean; fn: (a: string, z?: string | null, c?: string | null) => Promise<ParcelHit | null> },
  // Likewise after queryNYC — NYC Open Data PLUTO has richer fields for
  // the 5 boroughs. NYS Tax Parcels covers ~30 upstate + LI counties
  // that opted into the state GIS-sharing program. Nassau is a notable
  // holdout (did not opt in) — Nassau falls through to OpenStreetMap.
  {
    match: (s) => s === "NY",
    fn: (addr) => queryNYStatewide(addr),
  } as { match: (s: string, c: string) => boolean; fn: (a: string, z?: string | null, c?: string | null) => Promise<ParcelHit | null> },
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
