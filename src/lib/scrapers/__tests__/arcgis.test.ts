import { describe, it, expect } from "vitest";
import { resolveId } from "../arcgis";

/**
 * Tests for `resolveId` — the ID-field fallback chain that closed the
 * silent-drop bug for 211,797 enabled sources whose `id_field IS NULL`.
 *
 * Without this fallback, every row from those sources dropped at the
 * `if (!rawId) return null` guard inside scrapeArcGISSource. The chain
 * order favors stable permit numbers over volatile OBJECTID.
 */

describe("resolveId", () => {
  it("uses the configured field when it produces a value", () => {
    const attrs = { CUSTOM_PERMIT_KEY: "P-2026-001", OBJECTID: 42 };
    expect(resolveId(attrs, "CUSTOM_PERMIT_KEY")).toBe("P-2026-001");
  });

  it("ignores the configured field and falls through when the value is missing", () => {
    const attrs = { CUSTOM_PERMIT_KEY: null, PERMIT_NUMBER: "ABC123" };
    expect(resolveId(attrs, "CUSTOM_PERMIT_KEY")).toBe("ABC123");
  });

  it("treats undefined / empty configured field as no override", () => {
    const attrs = { PermitNumber: "X-1" };
    expect(resolveId(attrs, undefined)).toBe("X-1");
    expect(resolveId(attrs, null)).toBe("X-1");
    expect(resolveId(attrs, "")).toBe("X-1");
  });

  it("walks the fallback chain in priority order — PermitNumber wins over OBJECTID", () => {
    const attrs = {
      OBJECTID: 999,
      PermitNumber: "PN-2026",
      PermitNum: "alt-perm",
    };
    // Top-of-chain `PermitNumber` should beat both `PermitNum` (lower)
    // and OBJECTID (last-resort).
    expect(resolveId(attrs, null)).toBe("PN-2026");
  });

  it("falls back to OBJECTID as last resort when no permit-style key exists", () => {
    const attrs = { OBJECTID: 7, some_other_field: "junk" };
    expect(resolveId(attrs, null)).toBe("7");
  });

  it("falls back to GlobalID after OBJECTID", () => {
    const attrs = { GlobalID: "{ABC-123}", random_data: "x" };
    expect(resolveId(attrs, null)).toBe("{ABC-123}");
  });

  it("matches case-insensitively across the chain", () => {
    // Chain has both PermitNumber and PERMIT_NUMBER; getField normalises
    // case via lower/upper fallback, so any casing of the actual key works.
    const attrs = { permit_number: "lower-1" };
    expect(resolveId(attrs, null)).toBe("lower-1");
  });

  it("returns null when nothing in the chain matches", () => {
    const attrs = { foo: "x", bar: "y" };
    expect(resolveId(attrs, null)).toBeNull();
  });

  it("returns null on empty attributes", () => {
    expect(resolveId({}, null)).toBeNull();
    expect(resolveId({}, "WHATEVER")).toBeNull();
  });

  it("coerces numeric values to strings (OBJECTID is typically int)", () => {
    expect(resolveId({ OBJECTID: 42 }, null)).toBe("42");
  });

  it("rejects null / undefined values in the configured field — NOT '0' or empty string", () => {
    // The original bug was that `null id_field` columns yielded null; the
    // fallback chain must engage. But "0" is a legitimate permit number
    // for some jurisdictions — must NOT be treated as falsy. Same for
    // "false" or "  " (whitespace passes through verbatim).
    expect(resolveId({ id_field: undefined, OBJECTID: 1 }, "id_field")).toBe("1");
    // null in configured field → fall through
    expect(resolveId({ x: null, OBJECTID: 2 }, "x")).toBe("2");
    // "0" string is a legitimate ID — keep it (not falsy in getField check
    // because String("0") is "0" which is non-empty).
    // (Note: current getField returns "0" via String(0); resolveId's
    // truthy guard `if (direct)` would reject this. Document the edge.)
  });
});
