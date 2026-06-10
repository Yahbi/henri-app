import { describe, it, expect } from "vitest";
import { detectFields } from "../field-detect";

describe("detectFields", () => {
  it("maps Chicago Socrata permit columns", () => {
    const cols = [
      "id", "permit_", "permit_type", "review_type", "application_start_date",
      "issue_date", "work_description", "total_fee", "contact_1_name",
      "street_number", "street_name", "work_type", "latitude", "longitude",
    ];
    const r = detectFields(cols, "socrata", "Building Permits");
    expect(r.idField).toBe("permit_");
    expect(r.dateField).toBe("issue_date");
    expect(r.typeField).toBe("permit_type");
    expect(r.descField).toBe("work_description");
    expect(r.latField).toBe("latitude");
    expect(r.lngField).toBe("longitude");
    expect(r.enable).toBe(true);
    expect(r.hasRealId).toBe(true);
  });

  it("prefers issue_date over applied_date", () => {
    const r = detectFields(
      ["permit_number", "applied_date", "issue_date", "address"],
      "socrata",
      "Permits",
    );
    expect(r.dateField).toBe("issue_date");
  });

  it("falls back to applied date when no issue date", () => {
    const r = detectFields(
      ["permitnum", "applieddate", "originaladdress1"],
      "socrata",
      "Cincinnati Building Permits",
    );
    expect(r.idField).toBe("permitnum");
    expect(r.dateField).toBe("applieddate");
    expect(r.addressField).toBe("originaladdress1");
    expect(r.enable).toBe(true);
  });

  it("does NOT set lat/lng for arcgis (geometry covers it)", () => {
    const r = detectFields(
      ["PermitNumber", "IssuedDate", "Address", "latitude", "longitude"],
      "arcgis",
      "Permits",
    );
    expect(r.latField).toBeNull();
    expect(r.lngField).toBeNull();
    expect(r.idField).toBe("PermitNumber");
  });

  it("uses a combined location column for socrata when no lat/lng pair", () => {
    const r = detectFields(
      ["permit_number", "issue_permit_date", "permit_address", "location"],
      "socrata",
      "Orlando Permit Applications",
    );
    expect(r.latField).toBe("location");
    expect(r.lngField).toBe("location");
  });

  it("uses objectid fallback but flags hasRealId false", () => {
    const r = detectFields(
      ["objectid", "issue_date", "address", "permit_class"],
      "arcgis",
      "Building Permits",
    );
    expect(r.idField).toBe("objectid");
    expect(r.hasRealId).toBe(false);
    // name says permits, so still enabled
    expect(r.enable).toBe(true);
  });

  it("refuses to enable a non-permit dataset (false positive guard)", () => {
    const r = detectFields(
      ["objectid", "created_date", "street_name", "zone_class"],
      "arcgis",
      "Zoning Districts",
    );
    expect(r.enable).toBe(false);
    expect(r.looksLikePermits).toBe(false);
  });

  it("does not enable without a date field", () => {
    const r = detectFields(
      ["permit_number", "address", "status"],
      "socrata",
      "Building Permits",
    );
    expect(r.enable).toBe(false);
  });

  it("preserves original column casing", () => {
    const r = detectFields(
      ["PERMIT_NUM", "DATE_ISSUED", "ADDRESS", "VALUATION"],
      "arcgis",
      "Denver Residential Construction Permits",
    );
    expect(r.idField).toBe("PERMIT_NUM");
    expect(r.dateField).toBe("DATE_ISSUED");
    expect(r.valueField).toBe("VALUATION");
  });

  it("handles empty/garbage column lists safely", () => {
    const r = detectFields([], "socrata", "");
    expect(r.idField).toBeNull();
    expect(r.enable).toBe(false);
  });
});
