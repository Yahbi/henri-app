import { describe, it, expect } from "vitest";
import {
  asIsoDate,
  asZip,
  dedupeParcelRows,
  groupRowsByShape,
  isParcelMappingFailure,
  mapParcelRow,
  resolveFieldMap,
  type ParcelSidecarRow,
} from "../field-map";

/**
 * These cover the two things that decide whether the parcels-sidecar cron is
 * correct or destructive:
 *
 *   1. field_map application, across BOTH canonical vocabularies present in
 *      the live registry (migration 00085's `situs_addr` style and the later
 *      research sessions' `site_address` style).
 *   2. NULL OMISSION — an absent value must be absent from the row object,
 *      never present-as-null, because `merge-duplicates` writes every key it
 *      is given and a supplied null erases.
 *
 * Field maps below are the ones actually stored in `parcel_sources`
 * (verified live 2026-08-07).
 */

const WV_SITE_ADDRESSES = {
  situs_zip: "Zip",
  situs_addr: "FULLADDR",
  situs_city: "MUNICIPALITY",
  resident_phone: "Res_Phone",
  source_parcel_id: "SITEADDID",
};

const WV_PARCEL_SUMMARY = {
  acres: "Acres_C",
  county_id: "CountyID",
  parcel_id: "GISPID",
  owner_name: "FullOwnerName",
  site_address: "FullPhysicalAddress",
  legal_description: "FullLegalDescription",
  owner_mailing_address: "FullOwnerAddress",
};

function map(fieldMap: Record<string, unknown>, upstream: Record<string, unknown>) {
  return mapParcelRow({
    sourceKey: "TEST-SOURCE",
    stateCode: "WV",
    resolved: resolveFieldMap(fieldMap),
    upstream,
  });
}

describe("resolveFieldMap", () => {
  it("reads the migration-00085 vocabulary (exact sidecar column names)", () => {
    const r = resolveFieldMap(WV_SITE_ADDRESSES);
    expect(r.get("source_parcel_id")).toBe("SITEADDID");
    expect(r.get("situs_addr")).toBe("FULLADDR");
    expect(r.get("resident_phone")).toBe("Res_Phone");
  });

  it("reads the later research-session vocabulary via aliases", () => {
    // `parcel_id` / `site_address` / `owner_mailing_address` are NOT
    // parcels_sidecar column names; without the alias layer this whole group
    // of 62 registry rows would map nothing at all.
    const r = resolveFieldMap(WV_PARCEL_SUMMARY);
    expect(r.get("source_parcel_id")).toBe("GISPID");
    expect(r.get("situs_addr")).toBe("FullPhysicalAddress");
    expect(r.get("owner_mailing_addr")).toBe("FullOwnerAddress");
    expect(r.get("owner_name")).toBe("FullOwnerName");
  });

  it("ignores canonical keys with no sidecar column — they survive in raw_json", () => {
    const r = resolveFieldMap(WV_PARCEL_SUMMARY);
    expect([...r.keys()]).not.toContain("acres");
    expect([...r.keys()]).not.toContain("legal_description");
  });

  it("prefers the exact column name over a synonym", () => {
    const r = resolveFieldMap({ total_value: "WRONG", total_appraisal: "RIGHT" });
    expect(r.get("total_appraisal")).toBe("RIGHT");
  });

  it("is case-insensitive on the canonical side and ignores non-strings", () => {
    const r = resolveFieldMap({ OWNER_NAME: "OWN", situs_addr: 42, parcel_id: "PID" });
    expect(r.get("owner_name")).toBe("OWN");
    expect(r.has("situs_addr")).toBe(false);
    expect(r.get("source_parcel_id")).toBe("PID");
  });

  it("survives null / empty / non-object field_map", () => {
    expect(resolveFieldMap(null).size).toBe(0);
    expect(resolveFieldMap(undefined).size).toBe(0);
    expect(resolveFieldMap({}).size).toBe(0);
    expect(resolveFieldMap({ parcel_id: "  " }).size).toBe(0);
  });
});

describe("mapParcelRow — NULL OMISSION", () => {
  it("OMITS a column whose upstream value is null — never sends it as null", () => {
    // This is the whole contract. `merge-duplicates` writes every key it is
    // given, so a present-but-null key ERASES an existing value, while an
    // absent key leaves it untouched.
    const row = map(WV_SITE_ADDRESSES, {
      SITEADDID: "SID54071-6600",
      FULLADDR: "1546 HICKMAN RIDGE RD",
      MUNICIPALITY: "STRANGE CREEK",
      Zip: "26639",
      Res_Phone: null,
    })!;
    expect(row).not.toBeNull();
    expect("resident_phone" in row).toBe(false);
    expect(Object.values(row)).not.toContain(null);
    expect(row.situs_addr).toBe("1546 HICKMAN RIDGE RD");
  });

  it("omits columns whose upstream key is missing entirely", () => {
    const row = map(WV_SITE_ADDRESSES, { SITEADDID: "SID-1" })!;
    expect(Object.keys(row).sort()).toEqual(
      ["raw_json", "source_key", "source_parcel_id", "state_code"].sort(),
    );
  });

  it("omits on blank, whitespace and upstream null sentinels", () => {
    for (const blank of ["", "   ", "NULL", "null", "N/A", "None", "<null>"]) {
      const row = map(WV_SITE_ADDRESSES, { SITEADDID: "SID-1", FULLADDR: blank })!;
      expect("situs_addr" in row, `blank=${JSON.stringify(blank)}`).toBe(false);
    }
  });

  it("keeps a legitimately zero numeric rather than omitting it", () => {
    // 0 is a real assessed value; only null/blank may be omitted.
    const row = map({ parcel_id: "PID", total_value: "VAL" }, { PID: "1", VAL: 0 })!;
    expect(row.total_appraisal).toBe(0);
  });

  it("never emits null for ANY column across a mixed page", () => {
    const upstream = [
      { SITEADDID: "a", FULLADDR: "1 MAIN ST", Zip: "26639", Res_Phone: "3046510550" },
      { SITEADDID: "b", FULLADDR: null, Zip: null, Res_Phone: null },
      { SITEADDID: "c", MUNICIPALITY: "ELKINS" },
    ];
    const rows = upstream.map((u) => map(WV_SITE_ADDRESSES, u)!);
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        expect(v, `${k} must not be null`).not.toBeNull();
        expect(v, `${k} must not be undefined`).not.toBeUndefined();
      }
    }
  });
});

describe("mapParcelRow — identity + coercion", () => {
  it("returns null when no source_parcel_id column is configured", () => {
    expect(map({ owner_name: "NAME" }, { NAME: "SMITH JOHN" })).toBeNull();
  });

  it("returns null when the configured id column is absent or blank", () => {
    expect(map(WV_SITE_ADDRESSES, { FULLADDR: "1 MAIN ST" })).toBeNull();
    expect(map(WV_SITE_ADDRESSES, { SITEADDID: "   " })).toBeNull();
  });

  it("always carries source_key, state_code and the full raw record", () => {
    const upstream = { GISPID: "54-01-1", FullOwnerName: "LOUK FRED V", Acres_C: 3.2 };
    const row = mapParcelRow({
      sourceKey: "WV-PARCEL-SUMMARY",
      stateCode: "WV",
      resolved: resolveFieldMap(WV_PARCEL_SUMMARY),
      upstream,
    })!;
    expect(row.source_key).toBe("WV-PARCEL-SUMMARY");
    expect(row.state_code).toBe("WV");
    expect(row.source_parcel_id).toBe("54-01-1");
    // Unmapped upstream columns are preserved for a later re-normalise pass.
    expect(row.raw_json).toEqual(upstream);
  });

  it("matches upstream keys case-insensitively", () => {
    // ArcGIS casing differs per tenant; the registry records one spelling.
    const row = map({ parcel_id: "gispid", owner_name: "fullownername" }, {
      GISPID: "X1",
      FullOwnerName: "SMITH JOHN",
    })!;
    expect(row.source_parcel_id).toBe("X1");
    expect(row.owner_name).toBe("SMITH JOHN");
  });

  it("coerces numeric columns and rejects junk", () => {
    const fm = { parcel_id: "P", total_value: "T", year_built: "Y", building_sqft: "S" };
    const row = map(fm, { P: "1", T: "$1,250,000", Y: "1974", S: "2,410" })!;
    expect(row.total_appraisal).toBe(1250000);
    expect(row.built_year).toBe(1974);
    expect(row.building_sqft).toBe(2410);

    const junk = map(fm, { P: "1", T: "n/a", Y: "unknown" })!;
    expect("total_appraisal" in junk).toBe(false);
    expect("built_year" in junk).toBe(false);
  });

  it("rejects an integer-overflowing year/sqft rather than 22003-ing the batch", () => {
    const row = map({ parcel_id: "P", year_built: "Y" }, { P: "1", Y: 99999999999 })!;
    expect("built_year" in row).toBe(false);
  });
});

describe("asZip", () => {
  it("restores the leading zero ArcGIS drops from numeric ZIP columns", () => {
    // 07001 arrives as the number 7001; the (state_code, situs_zip) index and
    // the pre-intent synthesis cron both match the 5-character form.
    expect(asZip(7001)).toBe("07001");
    expect(asZip(601)).toBe("00601");
  });

  it("truncates ZIP+4 to the 5-digit prefix", () => {
    expect(asZip("26639-1234")).toBe("26639");
    expect(asZip(266391234)).toBe("26639");
  });

  it("passes a clean 5-digit ZIP through and rejects non-numeric junk", () => {
    expect(asZip("26639")).toBe("26639");
    expect(asZip("STRANGE CREEK")).toBeNull();
    expect(asZip(null)).toBeNull();
    expect(asZip("")).toBeNull();
  });
});

describe("asIsoDate", () => {
  it("decodes ArcGIS epoch milliseconds", () => {
    expect(asIsoDate(Date.UTC(2019, 2, 1))).toBe("2019-03-01");
  });

  it("parses ISO and US date strings", () => {
    expect(asIsoDate("2019-03-01")).toBe("2019-03-01");
    expect(asIsoDate("2019-03-01T12:00:00Z")).toBe("2019-03-01");
  });

  it("REJECTS a bare four-digit year rather than fabricating a month and day", () => {
    // OK-OKLAHOMA-COUNTY ships `saledate: 2019`. Widening that to 2019-01-01
    // would move a real November sale by eleven months, and recent_transfer_at
    // drives a freshness signal the scorer cannot sanity-check. The raw value
    // still survives in raw_json.
    expect(asIsoDate(2019)).toBeNull();
    expect(asIsoDate("2019")).toBeNull();
  });

  it("rejects zero, junk and out-of-range sentinel dates", () => {
    expect(asIsoDate(0)).toBeNull();
    expect(asIsoDate("not a date")).toBeNull();
    expect(asIsoDate(null)).toBeNull();
    // 1899 / 9999 sentinels are common in assessor exports.
    expect(asIsoDate("1899-12-30")).toBeNull();
    expect(asIsoDate("9999-01-01")).toBeNull();
  });
});

describe("groupRowsByShape", () => {
  const rows = [
    { source_key: "S", state_code: "WV", source_parcel_id: "1", raw_json: {}, owner_name: "A" },
    { source_key: "S", state_code: "WV", source_parcel_id: "2", raw_json: {}, owner_name: "B" },
    { source_key: "S", state_code: "WV", source_parcel_id: "3", raw_json: {} },
  ] as ParcelSidecarRow[];

  it("splits rows with differing key sets into homogeneous batches", () => {
    // supabase-js sends ?columns=<union of every key in the array>, and
    // PostgREST then writes EVERY listed column on the ON CONFLICT UPDATE
    // branch — so row 3 in a mixed batch would null owner_name for rows it
    // conflicts with. Grouping is what prevents that.
    const groups = groupRowsByShape(rows);
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      const signatures = new Set(g.map((r) => Object.keys(r).sort().join(",")));
      expect(signatures.size).toBe(1);
    }
  });

  it("guarantees each group's key union equals each row's own keys", () => {
    for (const g of groupRowsByShape(rows)) {
      const union = new Set(g.flatMap((r) => Object.keys(r)));
      for (const r of g) {
        expect(new Set(Object.keys(r))).toEqual(union);
      }
    }
  });

  it("keeps identical shapes in one batch and handles the empty case", () => {
    expect(groupRowsByShape(rows.slice(0, 2))).toHaveLength(1);
    expect(groupRowsByShape([])).toEqual([]);
  });

  it("loses no rows", () => {
    expect(groupRowsByShape(rows).flat()).toHaveLength(rows.length);
  });
});

describe("dedupeParcelRows", () => {
  it("keeps the last row per (state_code, source_parcel_id)", () => {
    // A repeated conflict key raises 21000 and aborts the ENTIRE statement,
    // not just the duplicate. Measured collisions exist in the live registry:
    // OK-CANADIAN-COUNTY yields 1,976 distinct parcel_id per 2,000 rows.
    const rows = [
      { source_key: "S", state_code: "OK", source_parcel_id: "1", raw_json: { v: 1 } },
      { source_key: "S", state_code: "OK", source_parcel_id: "1", raw_json: { v: 2 } },
      { source_key: "S", state_code: "OK", source_parcel_id: "2", raw_json: { v: 3 } },
    ] as ParcelSidecarRow[];
    const out = dedupeParcelRows(rows);
    expect(out).toHaveLength(2);
    expect(out[0].raw_json).toEqual({ v: 2 });
  });

  it("does not merge the same parcel id across different states", () => {
    const rows = [
      { source_key: "A", state_code: "WV", source_parcel_id: "1", raw_json: {} },
      { source_key: "B", state_code: "OK", source_parcel_id: "1", raw_json: {} },
    ] as ParcelSidecarRow[];
    expect(dedupeParcelRows(rows)).toHaveLength(2);
  });
});

describe("isParcelMappingFailure", () => {
  it("flags a page that produced no writable row", () => {
    expect(isParcelMappingFailure(1000, 0)).toBe(true);
  });

  it("does not flag a genuinely exhausted feed", () => {
    expect(isParcelMappingFailure(0, 0)).toBe(false);
  });

  it("does not flag a partially-mapped page", () => {
    expect(isParcelMappingFailure(1000, 998)).toBe(false);
  });
});
