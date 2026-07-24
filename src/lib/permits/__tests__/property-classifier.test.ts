import { describe, it, expect } from "vitest";
import { classifyPropertyType } from "../property-classifier";

describe("classifyPropertyType", () => {
  it("flags clearly commercial permit types", () => {
    expect(classifyPropertyType("Commercial Building Permit")).toBe("commercial");
    expect(classifyPropertyType("Building Permit (Commercial) - Tenant Improvement")).toBe("commercial");
    expect(classifyPropertyType("Non-Residential Alteration")).toBe("commercial");
    expect(classifyPropertyType("Retail Store Remodel")).toBe("commercial");
    expect(classifyPropertyType("Restaurant Tenant Improvement")).toBe("commercial");
    expect(classifyPropertyType("Warehouse Addition")).toBe("commercial");
    expect(classifyPropertyType("Hospital Interior Renovation")).toBe("commercial");
  });

  it("uses the description when the type is generic", () => {
    expect(classifyPropertyType("Building Permit", "Office tenant improvement, 3rd floor")).toBe("commercial");
    expect(classifyPropertyType("Alteration", "Single family dwelling kitchen remodel")).toBe("residential");
  });

  it("flags clearly residential permit types", () => {
    expect(classifyPropertyType("Residential Reroof")).toBe("residential");
    expect(classifyPropertyType("Single Family Dwelling - Addition")).toBe("residential");
    expect(classifyPropertyType("1-2 Family Electrical")).toBe("residential");
    expect(classifyPropertyType("Accessory Dwelling Unit (ADU)")).toBe("residential");
    expect(classifyPropertyType("Duplex Plumbing Permit")).toBe("residential");
  });

  it("does not read 'non-residential' as residential", () => {
    // Contains the substring 'residential' but is clearly commercial.
    expect(classifyPropertyType("Non-Residential Building Permit")).toBe("commercial");
    expect(classifyPropertyType("Nonresidential Electrical")).toBe("commercial");
  });

  it("returns unknown for project-type-only strings (no property signal)", () => {
    // These are exactly the ambiguous majority the 'Exclude commercial'
    // filter must KEEP visible — never guess them commercial.
    expect(classifyPropertyType("Roofing Permit")).toBe("unknown");
    expect(classifyPropertyType("Building Permit")).toBe("unknown");
    expect(classifyPropertyType("Electrical")).toBe("unknown");
    expect(classifyPropertyType("Plumbing - Water Heater")).toBe("unknown");
  });

  it("returns unknown when both signals appear", () => {
    expect(classifyPropertyType("Mixed residential and commercial project")).toBe("unknown");
  });

  it("returns unknown on empty / null input", () => {
    expect(classifyPropertyType("")).toBe("unknown");
    expect(classifyPropertyType(null, null)).toBe("unknown");
    expect(classifyPropertyType(undefined)).toBe("unknown");
  });

  it("does not match 'house' inside 'warehouse'", () => {
    // 'warehouse' is commercial and must not trip the residential 'house' path
    // (which is why 'house' isn't a residential keyword at all).
    expect(classifyPropertyType("Warehouse Reroof")).toBe("commercial");
  });
});
