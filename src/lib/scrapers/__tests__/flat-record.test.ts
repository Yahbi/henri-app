import { describe, it, expect } from "vitest";
import { normalizeFlatRecord, resolveAddress, resolveZip } from "../flat-record";
import { coordinatePair } from "../geo";
import type { PermitSource } from "../sources";

/**
 * Row-mapping tests for the flat-JSON (Socrata + CKAN) path.
 *
 * Covers the data-corruption defects found in the 2026-08-04 audit:
 *   - Socrata location OBJECTS stringified to "[object Object]" (126,754
 *     permits, 100% with a NULL zip, all silently absent from the pipeline).
 *   - A lone latitude written without a longitude (14,910 rows).
 *   - `scored_at: null` on every upsert, which reset already-scored permits
 *     and reverted contractor-owned lead status back to "new".
 *   - Contact columns never populated despite the data sitting in raw_json.
 */

const LA_SOURCE: PermitSource = {
  city: "Los Angeles",
  state: "CA",
  endpoint: "https://data.lacity.org/resource/nbyu-2ha9.json",
  idField: "pcis_permit",
  typeField: "permit_type",
  statusField: "status",
  descField: "work_description",
  addressField: "location_1",
  dateField: "issue_date",
  valueField: "valuation",
  latField: "latitude",
  lngField: "longitude",
};

describe("resolveAddress", () => {
  it("never returns the '[object Object]' sentinel for a GeoJSON location", () => {
    // The exact live shape from los_angeles_01LA12164.
    const r = resolveAddress(
      {
        location_1: { type: "Point", coordinates: [-118.29097, 34.04407] },
        address_start: "1660",
        street_direction: "W",
        street_name: "VENICE",
        street_suffix: "BLVD",
      },
      "location_1",
    );
    expect(r.address).not.toBe("[object Object]");
    // Street rebuilt from the component columns, as fetcher.ts already did.
    expect(r.address).toBe("1660 W VENICE BLVD");
    // GeoJSON is [lng, lat] — the coordinates must not be transposed.
    expect(r.lng).toBeCloseTo(-118.29097, 5);
    expect(r.lat).toBeCloseTo(34.04407, 5);
  });

  it("reads the legacy human_address shape for street and ZIP", () => {
    const r = resolveAddress(
      {
        loc: {
          latitude: "34.04407",
          longitude: "-118.29097",
          human_address: '{"address":"1660 W VENICE BLVD","city":"LOS ANGELES","state":"CA","zip":"90006"}',
        },
      },
      "loc",
    );
    expect(r.address).toBe("1660 W VENICE BLVD");
    expect(r.zip).toBe("90006");
    expect(r.lat).toBeCloseTo(34.04407, 5);
  });

  it("survives a malformed human_address without throwing", () => {
    const r = resolveAddress({ loc: { human_address: "{not json" } }, "loc");
    expect(r.address).toBeNull();
  });

  it("passes a plain string address straight through", () => {
    expect(resolveAddress({ addr: "400 N ASHLEY DR" }, "addr").address).toBe("400 N ASHLEY DR");
  });

  it("returns null rather than an empty or missing address", () => {
    expect(resolveAddress({ addr: "   " }, "addr").address).toBeNull();
    expect(resolveAddress({}, "addr").address).toBeNull();
  });

  it("rejects a literal '[object Object]' string already present upstream", () => {
    expect(resolveAddress({ addr: "[object Object]" }, "addr").address).toBeNull();
  });
});

describe("resolveZip", () => {
  it("prefers the dedicated ZIP column over parsing the address", () => {
    // The old order asked extractZip first; because that returned the house
    // number for any 5-digit-leading address, this column was dead code on
    // exactly the BLDS feeds it was written for.
    const r = resolveZip({ zip_code: "98104" }, "12345 VENTURA BLVD", null);
    expect(r.zip).toBe("98104");
    expect(r.trusted).toBe(true);
  });

  it("prefers a ZIP found inside a structured location object", () => {
    const r = resolveZip({ zip_code: "11111" }, "1 Main St", "90006");
    expect(r.zip).toBe("90006");
    expect(r.trusted).toBe(true);
  });

  it("falls back to the address but marks the result untrusted", () => {
    const r = resolveZip({}, "400 N ASHLEY DR, TAMPA FL 33602", null);
    expect(r.zip).toBe("33602");
    expect(r.trusted).toBe(false);
  });

  it("returns null for a street-only address instead of the house number", () => {
    const r = resolveZip({}, "12345 VENTURA BLVD", null);
    expect(r.zip).toBeNull();
  });
});

describe("coordinatePair", () => {
  it("requires BOTH halves — a lone latitude is a mapping bug, not data", () => {
    expect(coordinatePair(34.05, null)).toBeNull();
    expect(coordinatePair(null, -118.24)).toBeNull();
  });
  it("rejects out-of-range values (state-plane / web-mercator)", () => {
    expect(coordinatePair(6500000, -13000000)).toBeNull();
    expect(coordinatePair(91, 0)).toBeNull();
  });
  it("rejects the (0,0) null-island sentinel", () => {
    expect(coordinatePair(0, 0)).toBeNull();
  });
  it("accepts a real pair", () => {
    expect(coordinatePair(34.05, -118.24)).toEqual({ lat: 34.05, lng: -118.24 });
  });
});

describe("normalizeFlatRecord", () => {
  const base = {
    pcis_permit: "01LA12164",
    permit_type: "Bldg-New",
    status: "Issued",
    work_description: "New SFD",
    issue_date: "2026-03-04T00:00:00.000",
    valuation: "470000",
    location_1: { type: "Point", coordinates: [-118.29097, 34.04407] },
    address_start: "1660",
    street_direction: "W",
    street_name: "VENICE",
    street_suffix: "BLVD",
    zip_code: "90006",
  };

  it("recovers address, ZIP and coordinates that used to be discarded", () => {
    const { row, usable } = normalizeFlatRecord(base, LA_SOURCE, "socrata");
    expect(row).not.toBeNull();
    expect(row!.address).toBe("1660 W VENICE BLVD");
    expect(row!.zip).toBe("90006");
    expect(row!.latitude).toBeCloseTo(34.04407, 5);
    expect(row!.longitude).toBeCloseTo(-118.29097, 5);
    expect(usable).toBe(true);
  });

  it("NEVER includes scored_at in the payload", () => {
    // A merge-duplicates upsert writes every supplied column, so shipping
    // `scored_at: null` re-queued already-scored permits and the scorer then
    // reset contractor-owned lead status back to "new" and wiped notes.
    const { row } = normalizeFlatRecord(base, LA_SOURCE, "socrata");
    expect(Object.prototype.hasOwnProperty.call(row!, "scored_at")).toBe(false);
  });

  it("does not write a lone coordinate when the lat/lng mapping is junk", () => {
    // The live LA source has lat_field='permit_type' and lng_field='street_suffix'.
    const junkSource: PermitSource = { ...LA_SOURCE, latField: "permit_type", lngField: "street_suffix" };
    const { row } = normalizeFlatRecord(
      { ...base, location_1: undefined },
      junkSource,
      "socrata",
    );
    // ABSENT, not null. This assertion used to be `toBeNull()`, which locked
    // in a data-destroying bug: the upsert runs with merge-duplicates, so a
    // supplied `latitude: null` becomes SET latitude = NULL and wipes
    // coordinates a previous geocode pass had resolved. Omitting the key
    // leaves the stored value untouched.
    expect(Object.prototype.hasOwnProperty.call(row!, "latitude")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row!, "longitude")).toBe(false);
  });

  it("omits zip entirely when this fetch could not resolve one", () => {
    // Same hazard as the coordinates above, and the more expensive one:
    // /api/cron/census-geocode backfills missing ZIPs, scrape re-runs hourly
    // over the same sources, and an unconditional `zip: null` erased each
    // backfilled ZIP on the next pass. Measured on production 2026-08-05,
    // distinct permit ZIPs fell 18,040 -> 16,551 across two scrape runs while
    // the geocoder was adding them. A permit with no ZIP cannot match a
    // territory, so every erased ZIP is a lead that cannot be created.
    const noZipSource: PermitSource = { ...LA_SOURCE, zipField: "nonexistent_column" };
    const { row } = normalizeFlatRecord(
      { ...base, zip_code: undefined, location_1: undefined, address: undefined },
      noZipSource,
      "socrata",
    );
    expect(Object.prototype.hasOwnProperty.call(row!, "zip")).toBe(false);
  });

  it("still writes zip and coordinates when this fetch DOES resolve them", () => {
    // The omission above must be conditional, not a blanket removal.
    const { row } = normalizeFlatRecord(base, LA_SOURCE, "socrata");
    expect(row!.zip).toBe("90006");
    expect(row!.latitude).toBeCloseTo(34.04407, 5);
    expect(row!.longitude).toBeCloseTo(-118.29097, 5);
  });

  it("persists owner and contractor contact fields found in the record", () => {
    const { row } = normalizeFlatRecord(
      { ...base, parcel_owner_name: "MORGAN MATTHEW B", contractor_phone_number: "(407)592-6291" },
      LA_SOURCE,
      "socrata",
    );
    // Orlando's 26,873 owner names live in `parcel_owner_name`, which the
    // old key list could not see.
    expect(row!.applicant_name).toBeTruthy();
    expect(row!.contact_source).toBeTruthy();
    expect(row!.contact_confidence).toBeTypeOf("number");
  });

  it("omits contact keys entirely when the record has none — never blanks them", () => {
    const { row } = normalizeFlatRecord(base, LA_SOURCE, "socrata");
    // An absent key is left untouched by ON CONFLICT DO UPDATE, so a sparse
    // re-fetch cannot erase an enriched value.
    expect(Object.prototype.hasOwnProperty.call(row!, "contractor_name")).toBe(false);
  });

  it("returns null when no id resolves — the mapping-failure signal", () => {
    const { row, usable } = normalizeFlatRecord({ nothing: 1 }, LA_SOURCE, "socrata");
    expect(row).toBeNull();
    expect(usable).toBe(false);
  });

  it("marks a row unusable when it has an id but no address and no date", () => {
    const { row, usable } = normalizeFlatRecord({ pcis_permit: "X1" }, LA_SOURCE, "socrata");
    expect(row).not.toBeNull();
    expect(usable).toBe(false);
  });

  it("does not let a free-text ZIP override the source's declared state", () => {
    // Live evidence: 251 sampled permits at Seattle coordinates from a
    // WA-declared feed were stored as NY because the address began with a
    // 5-digit house number in the 100xx range.
    const waSource: PermitSource = { ...LA_SOURCE, state: "WA", addressField: "addr", latField: "x", lngField: "y" };
    const { row } = normalizeFlatRecord(
      { pcis_permit: "P1", addr: "10000 HOLMAN RD NW", issue_date: "2026-01-01" },
      waSource,
      "socrata",
    );
    expect(row!.state).toBe("WA");
  });
});
