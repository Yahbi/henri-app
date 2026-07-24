import { describe, it, expect } from "vitest";
import {
  sanitizePropertyValue,
  MAX_PLAUSIBLE_PROPERTY_VALUE,
} from "../value-sanity";

describe("sanitizePropertyValue", () => {
  it("passes through plausible residential values", () => {
    expect(sanitizePropertyValue(450_000)).toBe(450_000);
    expect(sanitizePropertyValue(1_250_000)).toBe(1_250_000);
    expect(sanitizePropertyValue(MAX_PLAUSIBLE_PROPERTY_VALUE)).toBe(
      MAX_PLAUSIBLE_PROPERTY_VALUE,
    );
  });

  it("rejects the $380.9M outlier (above the ceiling)", () => {
    expect(sanitizePropertyValue(380_900_000)).toBeNull();
    expect(sanitizePropertyValue(MAX_PLAUSIBLE_PROPERTY_VALUE + 1)).toBeNull();
  });

  it("rejects zero, negative, and non-finite", () => {
    expect(sanitizePropertyValue(0)).toBeNull();
    expect(sanitizePropertyValue(-5)).toBeNull();
    expect(sanitizePropertyValue(Number.NaN)).toBeNull();
    expect(sanitizePropertyValue(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns null for null / undefined", () => {
    expect(sanitizePropertyValue(null)).toBeNull();
    expect(sanitizePropertyValue(undefined)).toBeNull();
  });
});
