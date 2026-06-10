import { describe, it, expect } from "vitest";
import { zipToState, deriveState } from "../normalizer";

describe("zipToState", () => {
  it("maps representative ZIPs to states", () => {
    expect(zipToState("33602")).toBe("FL"); // Tampa
    expect(zipToState("90012")).toBe("CA"); // LA
    expect(zipToState("10001")).toBe("NY"); // NYC
    expect(zipToState("60601")).toBe("IL"); // Chicago
    expect(zipToState("98101")).toBe("WA"); // Seattle
    expect(zipToState("80202")).toBe("CO"); // Denver
    expect(zipToState("20001")).toBe("DC");
    expect(zipToState("85001")).toBe("AZ"); // Phoenix
    expect(zipToState("96813")).toBe("HI"); // Honolulu
    expect(zipToState("99501")).toBe("AK"); // Anchorage
    expect(zipToState("28202")).toBe("NC"); // Charlotte
  });
  it("returns null for junk", () => {
    expect(zipToState(null)).toBeNull();
    expect(zipToState("")).toBeNull();
    expect(zipToState("abcde")).toBeNull();
    expect(zipToState("00000")).toBeNull();
  });
});

describe("deriveState", () => {
  it("prefers an explicit state token in the address", () => {
    expect(deriveState("123 Main St, Austin, TX 78701", "78701", "US")).toBe("TX");
  });
  it("falls back to ZIP-prefix mapping when no token", () => {
    expect(deriveState("123 Main St", "33602", "US")).toBe("FL");
  });
  it("overrides a junk 'US' source state from the ZIP", () => {
    expect(deriveState(null, "90012", "US")).toBe("CA");
  });
  it("keeps a valid fallback when address and zip are unusable", () => {
    expect(deriveState(null, null, "TX")).toBe("TX");
  });
  it("does not trust a junk fallback when nothing else resolves", () => {
    expect(deriveState(null, null, "US")).toBe("US"); // unchanged, nothing better
  });
  it("ignores a bogus 2-letter token that is not a real state", () => {
    // 'XX' is not a state; should fall through to ZIP
    expect(deriveState("1 A St, Town, XX 60601", "60601", "US")).toBe("IL");
  });
});
